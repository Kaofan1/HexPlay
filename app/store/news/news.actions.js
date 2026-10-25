export const SET_NEWS_ACTIVE = "SET_NEWS_ACTIVE"

export const setNewsActive = (status) => {
  return {
    type: SET_NEWS_ACTIVE,
    payload: status
  }
}
