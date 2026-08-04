(function (Neura) {
  function escapeHtml(unsafeText) {
    return unsafeText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  const NAMED_ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u00a0',
  };

  // Decode repeatedly: models / pipelines may double-encode (&amp;gt; → &gt; → >).
  function decodeHtmlEntities(text) {
    if (!text || typeof text !== 'string' || text.indexOf('&') === -1) return text;

    const decodeOnce = (input) =>
      input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity) => {
        if (entity[0] === '#') {
          const codePoint =
            entity[1] === 'x' || entity[1] === 'X'
              ? parseInt(entity.slice(2), 16)
              : parseInt(entity.slice(1), 10);
          if (Number.isNaN(codePoint)) return match;
          try {
            return String.fromCodePoint(codePoint);
          } catch (e) {
            return match;
          }
        }
        return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, entity)
          ? NAMED_ENTITIES[entity]
          : match;
      });

    let out = text;
    for (let i = 0; i < 4; i += 1) {
      const next = decodeOnce(out);
      if (next === out) break;
      out = next;
    }
    return out;
  }

  // Reasoning streams often use markdown blockquotes (> line) or escaped &gt; line
  // prefixes. Normalize for plain-text display in the thought panel.
  function normalizeThoughtText(text) {
    if (!text || typeof text !== 'string') return text;
    const decoded = decodeHtmlEntities(text);
    const lines = decoded.split('\n');
    const blockquoteLines = lines.filter((line) => /^>\s?/.test(line)).length;
    if (blockquoteLines >= Math.max(2, Math.ceil(lines.length * 0.4))) {
      return lines.map((line) => line.replace(/^>\s?/, '')).join('\n');
    }
    return decoded;
  }

  function parseMarkdown(text) {
    let html = text;

    html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
      const language = lang || 'plaintext';
      const escapedCode = escapeHtml(code.trim());
      return `<pre><code class="language-${language}">${escapedCode}</code></pre>`;
    });

    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    html = html.replace(/^### (.*$)/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gm, '<h1>$1</h1>');

    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');

    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');

    const tableRegex = /(\|.+\|(\r?\n|\r))+/g;
    html = html.replace(tableRegex, (match) => {
      const rows = match.trim().split(/\r?\n|\r/);
      let tableHtml = '<table class="markdown-table">';
      rows.forEach((row, index) => {
        const cells = row.split('|').filter((cell) => cell.trim() !== '');
        if (cells[0] && cells[0].match(/^[\s-:]+$/)) return;
        const tag = index === 0 ? 'th' : 'td';
        tableHtml += '<tr>';
        cells.forEach((cell) => {
          tableHtml += `<${tag}>${cell.trim()}</${tag}>`;
        });
        tableHtml += '</tr>';
      });
      tableHtml += '</table>';
      return tableHtml;
    });

    html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    html = html.replace(/^\s*\d+\.\s+(.+)$/gm, '<li>$1</li>');

    html = html.replace(
      /!\[([^\]]*)\]\((data:image\/[^)]+|https?:\/\/[^)]+)\)/gi,
      '<img src="$2" alt="$1" style="max-width:100%;height:auto;" loading="lazy" />',
    );

    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    html = html.replace(/^&gt;\s*(.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^>\s*(.+)$/gm, '<blockquote>$1</blockquote>');

    html = html.replace(/^---$/gm, '<hr>');

    html = html.replace(/(<\/li>\s*)\n+(\s*<li>)/g, '$1$2');
    html = html.replace(/\n\n+/g, '</p><p>');
    html = '<p>' + html + '</p>';
    html = html.replace(/\n(?![^<]*<\/li>)/g, '<br>');

    return html;
  }

  function highlightCodeBlocks(rootEl) {
    if (!rootEl || typeof Prism === 'undefined') return;
    rootEl.querySelectorAll('pre code').forEach((block) => {
      // While a message is streaming, the whole content (and every code
      // block) is re-parsed on each render pass. Re-highlighting a block
      // whose text hasn't changed since last time is pure waste, so skip
      // it; only blocks that grew (still streaming) or are new get re-run.
      const text = block.textContent || '';
      if (block.dataset.neuraHighlightedLen === String(text.length)) return;
      try {
        Prism.highlightElement(block);
        block.dataset.neuraHighlightedLen = String(text.length);
      } catch (e) {
        /* ignore */
      }
    });
  }

  Neura.markdown = {
    escapeHtml,
    decodeHtmlEntities,
    normalizeThoughtText,
    parseMarkdown,
    highlightCodeBlocks,
  };
})(window.Neura);
