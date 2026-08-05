(function (Neura) {
  Neura.frameAggregation = {
    install() {
      try {
        if (window !== window.top) {
          const collectTextFromFrame = () => {
            try {
              const body = document.body;
              if (!body) return '';
              const main = document.querySelector('[role="main"], main, article') || body;
              const text = main.innerText || '';
              return text && text.trim().length > 50 ? text : '';
            } catch (e) {
              return '';
            }
          };

          const payload = collectTextFromFrame();
          if (payload) {
            try {
              window.top.postMessage({ type: 'NEURA_IFRAME_TEXT', length: payload.length, text: payload }, '*');
            } catch {}
          }

          const obs = new MutationObserver(() => {
            const later = collectTextFromFrame();
            if (later) {
              try {
                window.top.postMessage({ type: 'NEURA_IFRAME_TEXT', length: later.length, text: later }, '*');
              } catch {}
            }
          });
          try {
            obs.observe(document.documentElement || document, {
              subtree: true,
              childList: true,
              characterData: true,
            });
            setTimeout(() => obs.disconnect(), 5000);
          } catch {}
        }

        if (window === window.top) {
          let bestIframeText = '';
          window.addEventListener('message', (event) => {
            const data = event.data;
            if (!data || data.type !== 'NEURA_IFRAME_TEXT') return;
            if (typeof data.text === 'string' && data.text.length > bestIframeText.length) {
              bestIframeText = data.text;
            }
          });
          window.__NEURA_GET_IFRAME_TEXT__ = () => bestIframeText;
        }
      } catch (e) {
        console.warn('Frame aggregation setup error:', e);
      }
    },
  };
})(window.Neura);
