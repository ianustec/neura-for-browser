(function (Neura) {
  /**
   * Partition Open WebUI assistant content into a user-facing answer and
   * collapsible "thought" extras.
   * Keep in sync with background/owui-content-partition.js (agent workspace delegate).
   *
   * OWUI embeds tool/reasoning audit trails as HTML details blocks, e.g.:
   *   <details type="tool_calls" ...><summary>Tool Executed</summary>{json}</details>
   *   <details type="reasoning" ...>...</details>
   * Between tool rounds the model also emits short status narrations. Those
   * belong in the thought panel; only the last text segment is the answer.
   */

  const DETAILS_OPEN_RE = /<details\b[^>]*>/i;
  const DETAILS_CLOSE = '</details>';

  /**
   * @param {string} openTag
   * @returns {{ type: string, name: string }}
   */
  function parseDetailsAttrs(openTag) {
    const typeMatch = openTag.match(/\btype\s*=\s*["']([^"']*)["']/i);
    const nameMatch = openTag.match(/\bname\s*=\s*["']([^"']*)["']/i);
    return {
      type: (typeMatch?.[1] || '').trim().toLowerCase(),
      name: (nameMatch?.[1] || '').trim(),
    };
  }

  /**
   * @param {string} inner
   * @returns {{ summary: string, body: string }}
   */
  function splitDetailsInner(inner) {
    const sumMatch = inner.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/i);
    if (!sumMatch) return { summary: '', body: inner.trim() };
    return {
      summary: String(sumMatch[1] || '').trim(),
      body: inner.slice(sumMatch.index + sumMatch[0].length).trim(),
    };
  }

  /**
   * Strip classic <think> / <reasoning> tags into thought + content.
   * @param {string} text
   * @returns {{ content: string, thought: string }}
   */
  function stripThinkTags(text) {
    if (!text) return { content: '', thought: '' };
    const thoughtParts = [];
    const pairs = [
      [/<think>/gi, /<\/think>/i],
      [/<THINK>/g, /<\/THINK>/],
      [/<reasoning>/gi, /<\/reasoning>/i],
      [/<redacted_thinking>/gi, /<\/redacted_thinking>/i],
    ];
    let content = text;
    for (const [openRe, closeRe] of pairs) {
      openRe.lastIndex = 0;
      let out = '';
      let cursor = 0;
      let m;
      const openSource = openRe.source;
      const openFlags = openRe.flags.replace('g', '') + 'g';
      const re = new RegExp(openSource, openFlags);
      while ((m = re.exec(content)) !== null) {
        out += content.slice(cursor, m.index);
        const afterOpen = m.index + m[0].length;
        const closeMatch = content.slice(afterOpen).match(closeRe);
        if (!closeMatch || closeMatch.index == null) {
          thoughtParts.push(content.slice(afterOpen).trim());
          cursor = content.length;
          break;
        }
        const body = content.slice(afterOpen, afterOpen + closeMatch.index).trim();
        if (body) thoughtParts.push(body);
        cursor = afterOpen + closeMatch.index + closeMatch[0].length;
        re.lastIndex = cursor;
      }
      out += content.slice(cursor);
      content = out;
    }
    return { content, thought: thoughtParts.filter(Boolean).join('\n\n') };
  }

  const PYTHON_FENCE_RE = /```(?:python|py)\s*\n([\s\S]*?)```/gi;
  const FILE_GEN_NARRATION_RE =
    /(?:^|\n)(?:Ora genero|Ottimo!|Vedo che|Adesso genero|Esegui il codice|Now I (?:will )?generat|I'll generat|Let me generat|Excellent!|I see that)[^\n]*(?:docx|DOCX|python|Python|\.docx|file)[^\n]*(?=\n|$)/gi;

  const AI_META_LINE_RES = [
    /^(?:Ho (?:letto|aperto|consultato)|I (?:have )?read)\s/i,
    /^(?:Ora (?:creo|genero|preparo|scrivo)|Now I (?:create|generat|write|prepare))/i,
    /^(?:Perfetto!|Perfect!|Excellent!|Ottimo!|Great!)\s/i,
    /^(?:Il (?:file )?DOCX (?:è stato|è)|The DOCX (?:file )?has been|Il documento (?:Word )?è stato)/i,
    /^(?:Il documento è pronto|Document is ready|Ready for download|Pronto per il download)/i,
    /^\*\*File:\*\*\s/i,
    /^File:\s*.+\.(docx|pdf|doc|xlsx)\s*$/i,
    /^✅/,
    /^(?:clicca|click)\s.*(?:Esporta|Export).*(?:DOCX|docx|Word)/i,
    /^(?:Usa |Use ).*(?:Esporta come DOCX|Export as DOCX)/i,
    /^(?:Per scaricare|To download).*(?:DOCX|docx|Export|Esporta)/i,
    /^(?:I need to use|Devo usare).*(?:Python|Pyodide|python-docx)/i,
  ];

  /**
   * @param {string} line
   * @returns {boolean}
   */
  function isMetaHeadingLine(line) {
    const normalized = stripEmojisForDocument(line).replace(/^#+\s*/, '').trim();
    return /^(?:Documento Creato|Document Created|File generato|Generated file|Riassunto Rapido|Quick Summary)$/i.test(
      normalized,
    );
  }

  /**
   * @param {string} text
   * @returns {string}
   */
  function stripEmojisForDocument(text) {
    if (!text) return '';
    return text
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /**
   * Remove chat-style status lines and fake "document created" wrappers from visible/export content.
   * @param {string} content
   * @param {string[]} thoughtParts
   * @returns {string}
   */
  function stripAiChatArtifacts(content, thoughtParts) {
    if (!content) return content;

    let out = content.replace(/\r\n/g, '\n');
    const lines = out.split('\n');
    /** @type {string[]} */
    const kept = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        kept.push('');
        continue;
      }
      if (isMetaHeadingLine(trimmed)) {
        thoughtParts.push(trimmed);
        continue;
      }
      if (AI_META_LINE_RES.some((re) => re.test(trimmed))) {
        thoughtParts.push(trimmed);
        continue;
      }
      kept.push(line);
    }

    out = kept
      .join('\n')
      .replace(/^(#+\s*)[📄📌✅🔧]+\s*/gm, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Drop leading preamble before the first real document heading.
    const headingIdx = out.search(/^#\s+\S/m);
    if (headingIdx > 0) {
      const preamble = out.slice(0, headingIdx).trim();
      if (preamble && AI_META_LINE_RES.some((re) => re.test(preamble.split('\n')[0] || ''))) {
        thoughtParts.push(preamble);
        out = out.slice(headingIdx).trim();
      }
    }

    return out;
  }

  /**
   * Move untagged file-generation scripts and status narration into the thought panel
   * (Conduit hides code_interpreter details; models often omit OWUI <details> tags).
   * @param {string} content
   * @param {string[]} thoughtParts
   * @returns {string}
   */
  function stripUntaggedGenerationArtifacts(content, thoughtParts) {
    if (!content) return content;
    let out = content;

    out = out.replace(PYTHON_FENCE_RE, (match, code) => {
      if (!looksLikeFileGenerationScript(code)) return match;
      thoughtParts.push(match.trim());
      return '\n';
    });

    out = out.replace(FILE_GEN_NARRATION_RE, (match) => {
      thoughtParts.push(match.trim());
      return '\n';
    });

    out = out.replace(/(?:^|\n)Esegui il codice Python[^\n]*(?=\n|$)/gi, (match) => {
      thoughtParts.push(match.trim());
      return '\n';
    });

    return out.replace(/\n{3,}/g, '\n\n').trim();
  }

  /**
   * @param {string} code
   * @returns {boolean}
   */
  function looksLikeFileGenerationScript(code) {
    if (!code || typeof code !== 'string') return false;
    const lines = code.split('\n').filter((l) => l.trim());
    if (lines.length < 6) return false;
    const lower = code.toLowerCase();
    const hasDocxImport = /from docx|import docx|python-docx/.test(lower);
    const hasFileWrite =
      /document\s*\(|\.save\s*\(|save\s*\(|open\s*\([^)]*['"][^'"]+\.(docx|pdf|xlsx)/.test(lower);
    const hasSubprocess = /subprocess|os\.path|shutil/.test(lower);
    return hasDocxImport || (hasFileWrite && /docx|word|document|pdf|xlsx/.test(lower)) || (hasSubprocess && hasDocxImport);
  }

  /**
   * @param {string} raw
   * @returns {{ content: string, thought: string, stats: { details: number, segments: number, rawLen: number, contentLen: number } }}
   */
  function partitionOwUiContent(raw) {
    const empty = {
      content: '',
      thought: '',
      stats: { details: 0, segments: 0, rawLen: 0, contentLen: 0 },
    };
    if (!raw || typeof raw !== 'string') return empty;

    const thoughtParts = [];
    const segments = [];
    let detailsCount = 0;
    let i = 0;
    let textBuf = '';

    while (i < raw.length) {
      const slice = raw.slice(i);
      const match = slice.match(DETAILS_OPEN_RE);
      if (!match || match.index == null) {
        textBuf += slice;
        break;
      }

      const detailsIdx = i + match.index;
      textBuf += raw.slice(i, detailsIdx);

      const openTag = match[0];
      const openEnd = detailsIdx + openTag.length;
      const closeIdx = raw.toLowerCase().indexOf(DETAILS_CLOSE, openEnd);
      if (closeIdx === -1) {
        // Unclosed details — hide the rest in thought to avoid dumping tool JSON.
        if (textBuf.trim()) segments.push(textBuf);
        textBuf = '';
        thoughtParts.push(raw.slice(detailsIdx).trim());
        detailsCount += 1;
        break;
      }

      if (textBuf.trim()) segments.push(textBuf);
      textBuf = '';

      const inner = raw.slice(openEnd, closeIdx);
      const { type, name } = parseDetailsAttrs(openTag);
      const { summary, body } = splitDetailsInner(inner);
      detailsCount += 1;

      if (type === 'reasoning' || type === 'thinking') {
        const cleaned = body
          .split('\n')
          .map((line) => line.replace(/^>\s?/, ''))
          .join('\n')
          .trim();
        if (cleaned) thoughtParts.push(cleaned);
      } else if (type === 'tool_calls' || type === 'code_interpreter') {
        const label = name || summary || type;
        thoughtParts.push(`🔧 ${label}`);
      } else {
        const label = summary || name || type || 'details';
        thoughtParts.push(label);
      }

      i = closeIdx + DETAILS_CLOSE.length;
    }

    if (textBuf.trim()) segments.push(textBuf);

    const trimmedSegments = segments.map((s) => s.trim()).filter(Boolean);
    const prior = trimmedSegments.slice(0, -1);
    if (prior.length) thoughtParts.unshift(...prior);

    let content = trimmedSegments.length ? trimmedSegments[trimmedSegments.length - 1] : '';
    const tagged = stripThinkTags(content);
    if (tagged.thought) thoughtParts.push(tagged.thought);
    content = stripUntaggedGenerationArtifacts(tagged.content.trim(), thoughtParts);
    content = stripAiChatArtifacts(content, thoughtParts);

    return {
      content,
      thought: thoughtParts.filter(Boolean).join('\n\n'),
      stats: {
        details: detailsCount,
        segments: trimmedSegments.length,
        rawLen: raw.length,
        contentLen: content.length,
      },
    };
  }

  Neura.contentPartition = {
    partitionOwUiContent,
    stripThinkTags,
    stripUntaggedGenerationArtifacts,
    stripAiChatArtifacts,
    stripEmojisForDocument,
    looksLikeFileGenerationScript,
  };
})(window.Neura);
