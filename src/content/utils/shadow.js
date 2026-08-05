(function (Neura) {
  Neura.shadow = {
    hostId: 'gptew-chat-container',
    host() {
      return document.getElementById(this.hostId);
    },
    root() {
      const h = this.host();
      return h ? h.shadowRoot : null;
    },
    $(id) {
      const r = this.root();
      return r ? r.getElementById(id) : null;
    },
    $$(selector) {
      const r = this.root();
      return r ? r.querySelector(selector) : null;
    },
  };
})(window.Neura);
