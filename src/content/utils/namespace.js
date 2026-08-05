(function () {
  const Neura = window.Neura || {};
  Neura.paths = Neura.paths || {
    icon: chrome.runtime.getURL('images/icon.png'),
    iconWhite: chrome.runtime.getURL('images/icon_white.png'),
  };
  window.Neura = Neura;
})();
