/* global COOKIE, USERINFO, CURRENTSERVERTIME */

const postStatusToParent = () => {
  const message = JSON.stringify({
    identifier: 'sendCookiePlus',
    payload: {
      cookie: COOKIE,
      userInfo: USERINFO,
      currentServerTime: CURRENTSERVERTIME,
    },
  });

  document.cookie = 'connect.sid=; expires=Thu, 01 Jan 1970 00:00:00 UTC;';
  window.ReactNativeWebView.postMessage(message);
};

module.exports = {
  makePostStatusToParentStr: ({ cookie, userInfo, currentServerTime }) =>
    String(postStatusToParent)
      .replace('COOKIE', JSON.stringify(cookie))
      .replace('USERINFO', JSON.stringify(userInfo))
      .replace('CURRENTSERVERTIME', JSON.stringify(currentServerTime)),
};
