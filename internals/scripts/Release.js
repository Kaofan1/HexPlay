#!/usr/bin/env node
/**
 * Jednopoleceniowe wydanie launchera.
 *
 *   yarn release patch          # 1.0.0 -> 1.0.1
 *   yarn release minor          # 1.0.0 -> 1.1.0
 *   yarn release major          # 1.0.0 -> 2.0.0
 *   yarn release 1.4.2          # konkretna wersja
 *   yarn release patch --dry-run
 *
 * Kolejność: podbicie wersji w package.json / app/package.json ->
 * commit + tag + push -> build NSIS -> publikacja GitHub Release.
 *
 * Wymaga zmiennej GH_TOKEN z uprawnieniem Contents: Read and write
 * dla repo wskazanego w build.publish.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BRANCH = 'main';
const VERSION_FILES = ['package.json', 'app/package.json', 'app/package-lock.json'];

function log(step, message) {
  console.log(`\n\u001b[36m[${step}]\u001b[0m ${message}`);
}

function fail(message) {
  console.error(`\n\u001b[31mBłąd:\u001b[0m ${message}`);
  process.exit(1);
}

function sh(command, { inherit = false } = {}) {
  return execSync(command, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe'
  }).trim();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(
    path.join(ROOT, file),
    `${JSON.stringify(value, null, 2)}\n`
  );
}

function parseVersion(raw) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(raw).trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function formatVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function compareVersions(a, b) {
  return (
    a.major - b.major || a.minor - b.minor || a.patch - b.patch
  );
}

function bumpVersion(current, kind) {
  const next = { ...current };
  if (kind === 'major') {
    next.major += 1;
    next.minor = 0;
    next.patch = 0;
  } else if (kind === 'minor') {
    next.minor += 1;
    next.patch = 0;
  } else if (kind === 'patch') {
    next.patch += 1;
  } else {
    return null;
  }
  return next;
}

function resolveYarn() {
  try {
    execSync('yarn --version', { cwd: ROOT, stdio: 'ignore' });
    return 'yarn';
  } catch (error) {
    try {
      execSync('corepack yarn --version', { cwd: ROOT, stdio: 'ignore' });
      return 'corepack yarn';
    } catch (innerError) {
      fail('Nie znaleziono yarn. Zainstaluj yarn 1.x albo włącz corepack.');
    }
  }
  return null;
}

async function githubRequest(pathname, options = {}) {
  const token = process.env.GH_TOKEN;
  const response = await fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'hexplay-launcher-release',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    data = { message: text };
  }

  return { ok: response.ok, status: response.status, data };
}

async function assertTokenCanPublish(owner, repo) {
  if (!process.env.GH_TOKEN) {
    fail(
      'Brak zmiennej GH_TOKEN.\n' +
        '  PowerShell:  $env:GH_TOKEN = "github_pat_..."\n' +
        '  bash:        export GH_TOKEN=github_pat_...\n' +
        'Token musi mieć uprawnienie Contents: Read and write dla tego repo.'
    );
  }

  const { ok, status, data } = await githubRequest(`/repos/${owner}/${repo}`);
  if (!ok) {
    fail(
      `GitHub odrzucił GH_TOKEN (HTTP ${status}): ${
        data.message || 'brak szczegółów'
      }`
    );
  }
  if (!data.permissions || !data.permissions.push) {
    fail(
      'GH_TOKEN nie ma uprawnień zapisu do repo. Wygeneruj fine-grained token ' +
        'z Contents: Read and write (albo classic token z zakresem repo).'
    );
  }
}

async function findRelease(owner, repo, tag) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { ok, status, data } = await githubRequest(
      `/repos/${owner}/${repo}/releases/tags/${tag}`
    );
    if (ok) return data;
    if (status !== 404) {
      fail(`Nie mogę odczytać release'u ${tag} (HTTP ${status}): ${data.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const kind = args.find(arg => !arg.startsWith('--'));

  if (!kind) {
    fail('Użycie: yarn release patch|minor|major|x.y.z [--dry-run]');
  }

  const pkg = readJson('package.json');
  const appPkg = readJson('app/package.json');
  const current = parseVersion(pkg.version);

  if (!current) fail(`Nieprawidłowa wersja w package.json: "${pkg.version}"`);
  if (appPkg.version !== pkg.version) {
    fail(
      `Wersje w package.json (${pkg.version}) i app/package.json (${appPkg.version}) ` +
        'różnią się. Wyrównaj je przed wydaniem.'
    );
  }

  const next = ['patch', 'minor', 'major'].includes(kind)
    ? bumpVersion(current, kind)
    : parseVersion(kind);

  if (!next) {
    fail(`Nieznany argument "${kind}". Użyj patch, minor, major albo numeru x.y.z.`);
  }
  if (compareVersions(next, current) <= 0) {
    fail(`Nowa wersja ${formatVersion(next)} musi być wyższa niż ${pkg.version}.`);
  }

  const version = formatVersion(next);
  const tag = `v${version}`;

  log('1/6', 'Sprawdzam repozytorium');
  let branch;
  try {
    branch = sh('git rev-parse --abbrev-ref HEAD');
  } catch (error) {
    fail('To nie jest repozytorium git.');
  }
  if (branch !== BRANCH) {
    fail(`Wydanie musi być tworzone z gałęzi ${BRANCH} (jesteś na ${branch}).`);
  }
  const dirty = sh('git status --porcelain');
  if (dirty && !dryRun) {
    fail('Drzewo robocze nie jest czyste. Zacommituj lub schowaj zmiany.');
  }
  if (sh('git remote') === '') {
    fail('Brak remote. Dodaj origin wskazujący na repo GitHub.');
  }
  try {
    sh(`git rev-parse -q --verify refs/tags/${tag}`);
    fail(`Tag ${tag} już istnieje.`);
  } catch (error) {
    // Brak tagu — oczekiwane.
  }

  const publish = (pkg.build && pkg.build.publish && pkg.build.publish[0]) || {};
  const owner = publish.owner;
  const repo = publish.repo;
  if (!owner || !repo) {
    fail('Uzupełnij build.publish (owner/repo) w package.json.');
  }

  if (dryRun) {
    log('DRY RUN', `Wersja ${pkg.version} -> ${version}, tag ${tag}`);
    console.log('  - bump: ' + VERSION_FILES.join(', '));
    console.log(`  - git commit "Release ${tag}" + git push origin ${BRANCH}`);
    console.log(`  - git tag ${tag} + git push origin ${tag}`);
    console.log('  - yarn build');
    console.log('  - electron-builder --win nsis --x64 --publish always');
    console.log(`  - weryfikacja release'u ${owner}/${repo} ${tag}`);
    return;
  }

  log('2/6', 'Sprawdzam token GitHub');
  await assertTokenCanPublish(owner, repo);

  log('3/6', `Podbijam wersję do ${version}`);
  for (const file of VERSION_FILES) {
    if (!fs.existsSync(path.join(ROOT, file))) continue;
    const json = readJson(file);
    json.version = version;
    writeJson(file, json);
    console.log(`  ${file}: ${version}`);
  }

  log('4/6', 'Commituję, taguję i wypycham');
  sh(`git add ${VERSION_FILES.join(' ')}`);
  sh(`git commit -m "Release ${tag}"`);
  sh(`git tag -a ${tag} -m "HexPlay Launcher ${version}"`);
  try {
    sh(`git push origin ${BRANCH}`);
    sh(`git push origin ${tag}`);
  } catch (error) {
    fail(
      'Nie udało się wypchnąć commita/taga. Wersja jest podbita lokalnie — ' +
        'napraw dostęp do remote i wypchnij ręcznie, potem uruchom build.'
    );
  }

  log('5/6', 'Buduję i publikuję instalator');
  const yarn = resolveYarn();
  sh(`${yarn} build`, { inherit: true });
  sh(`${yarn} electron-builder build --win nsis --x64 --publish always`, {
    inherit: true
  });

  log('6/6', 'Weryfikuję release');
  const release = await findRelease(owner, repo, tag);
  if (!release) fail(`Nie znalazłem release'u ${tag} po publikacji.`);

  if (release.draft) {
    const published = await githubRequest(
      `/repos/${owner}/${repo}/releases/${release.id}`,
      { method: 'PATCH', body: JSON.stringify({ draft: false }) }
    );
    if (!published.ok) {
      fail(`Release ${tag} został utworzony, ale nie udało się go opublikować.`);
    }
  }

  const assets = release.assets || [];
  const hasUpdaterFile = assets.some(asset => asset.name === 'latest.yml');
  const installer = assets.find(asset => /Setup.*\.exe$/i.test(asset.name));
  if (!hasUpdaterFile || !installer) {
    fail(
      `Release ${tag} nie ma wymaganych plików dla auto-update ` +
        '(latest.yml + instalator .exe).'
    );
  }

  const notes = [
    `Wydanie ${version} HexPlay Launcher.`,
    '',
    `Instalator: \`${installer.name}\``,
    '',
    'Instalator jest niepodpisany — SmartScreen może pokazać ostrzeżenie ' +
      '(„Więcej informacji” → „Uruchom mimo to”).'
  ].join('\n');

  await githubRequest(`/repos/${owner}/${repo}/releases/${release.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name: `HexPlay Launcher ${version}`, body: notes })
  });

  console.log(
    `\n\u001b[32mGotowe:\u001b[0m https://github.com/${owner}/${repo}/releases/tag/${tag}`
  );
  console.log(`Klienci na starszej wersji pobiorą aktualizację przy następnym starcie.`);
}

if (require.main === module) {
  main().catch(error => {
    fail(error && error.message ? error.message : String(error));
  });
}

module.exports = {
  parseVersion,
  formatVersion,
  bumpVersion,
  compareVersions
};
