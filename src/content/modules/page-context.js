(function (Neura) {
  function extractGenericPageText() {
    const mainContent =
      document.querySelector('main') ||
      document.querySelector('article') ||
      document.querySelector('[role="main"]') ||
      document.body;
    return mainContent ? mainContent.innerText : '';
  }

  async function getPageContext() {
    const currentUrl = window.location.href;
    const title = document.title;
    const descriptionTag = document.querySelector('meta[name="description"]');
    const description = descriptionTag ? descriptionTag.content : '';
    const text = extractGenericPageText();
    return { title, url: currentUrl, description, text };
  }

  async function getPageContextAsync() {
    return getPageContext();
  }

  Neura.pageContext = { getPageContext, getPageContextAsync };
})(window.Neura);
