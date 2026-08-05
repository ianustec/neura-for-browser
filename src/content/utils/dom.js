(function (Neura) {
  Neura.dom = {
    create(tag, props = {}, styles = '') {
      const el = document.createElement(tag);
      Object.assign(el, props);
      if (styles) el.style.cssText = styles;
      return el;
    },
  };
})(window.Neura);
