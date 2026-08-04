(function (Neura) {
  const lt = '<';
  const gt = '>';
  const TAG_PAIRS = [
    [`${lt}think${gt}`, `${lt}/think${gt}`],
    [`${lt}THINK${gt}`, `${lt}/THINK${gt}`],
    [`${lt}redacted_thinking${gt}`, `${lt}/redacted_thinking${gt}`],
    [`${lt}reasoning${gt}`, `${lt}/reasoning${gt}`],
    ['[思考]', '[/思考]'],
  ];

  // Any OWUI <details> block (reasoning, tool_calls, code_interpreter, …).
  const DETAILS_OPEN_RE = /<details\b[^>]*>/i;

  function maxPartialPrefix(text, prefixes) {
    let max = 0;
    for (const prefix of prefixes) {
      for (let len = Math.min(text.length, prefix.length - 1); len > 0; len -= 1) {
        if (prefix.startsWith(text.slice(-len)) && len > max) max = len;
      }
    }
    return max;
  }

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

  function findNextReasoningStart(text) {
    let earliest = -1;
    let kind = null;
    let openLen = 0;
    let closeTag = '';
    let detailsType = '';
    let detailsName = '';

    const detailsMatch = text.match(DETAILS_OPEN_RE);
    if (detailsMatch && detailsMatch.index != null) {
      earliest = detailsMatch.index;
      kind = 'details';
      openLen = detailsMatch[0].length;
      closeTag = '</details>';
      const attrs = parseDetailsAttrs(detailsMatch[0]);
      detailsType = attrs.type;
      detailsName = attrs.name;
    }

    for (const [open, close] of TAG_PAIRS) {
      const idx = text.indexOf(open);
      if (idx !== -1 && (earliest === -1 || idx < earliest)) {
        earliest = idx;
        kind = 'tag';
        openLen = open.length;
        closeTag = close;
        detailsType = '';
        detailsName = '';
      }
    }

    if (earliest === -1) return null;
    return { index: earliest, kind, openLen, closeTag, detailsType, detailsName };
  }

  function createReasoningStreamSplitter() {
    let buffer = '';
    /** @type {'content' | 'reasoning' | 'skip'} */
    let mode = 'content';
    let closeTag = '';

    function feedChunk(chunk) {
      const out = { reasoning: '', content: '' };
      if (!chunk) return out;

      buffer += chunk;

      while (buffer.length > 0) {
        if (mode === 'skip') {
          const closeIdx = buffer.toLowerCase().indexOf(closeTag.toLowerCase());
          if (closeIdx === -1) {
            // Drop buffered tool JSON; keep only a possible partial close tag.
            const keep = maxPartialPrefix(buffer.toLowerCase(), [closeTag.toLowerCase()]);
            buffer = keep > 0 ? buffer.slice(buffer.length - keep) : '';
            break;
          }
          buffer = buffer.slice(closeIdx + closeTag.length);
          mode = 'content';
          closeTag = '';
          continue;
        }

        if (mode === 'reasoning') {
          const closeIdx = buffer.indexOf(closeTag);
          if (closeIdx === -1) {
            const keep = maxPartialPrefix(buffer, [closeTag]);
            const emitLen = buffer.length - keep;
            if (emitLen > 0) {
              out.reasoning += buffer.slice(0, emitLen);
              buffer = buffer.slice(emitLen);
            }
            break;
          }

          out.reasoning += buffer.slice(0, closeIdx);
          buffer = buffer.slice(closeIdx + closeTag.length);
          mode = 'content';
          closeTag = '';
          continue;
        }

        const next = findNextReasoningStart(buffer);
        if (!next) {
          const prefixes = TAG_PAIRS.map((pair) => pair[0]).concat(['<details', '<Details']);
          const keep = maxPartialPrefix(buffer, prefixes);
          const emitLen = buffer.length - keep;
          if (emitLen > 0) {
            out.content += buffer.slice(0, emitLen);
            buffer = buffer.slice(emitLen);
          }
          break;
        }

        out.content += buffer.slice(0, next.index);
        buffer = buffer.slice(next.index + next.openLen);

        if (next.kind === 'details') {
          const type = next.detailsType || '';
          if (type === 'tool_calls' || type === 'code_interpreter') {
            const label = next.detailsName || type;
            out.reasoning += `\n🔧 ${label}\n`;
            mode = 'skip';
            closeTag = next.closeTag;
            continue;
          }

          // reasoning / unknown details → thought panel (strip <summary>)
          const summaryEnd = buffer.indexOf('</summary>');
          if (summaryEnd !== -1) {
            buffer = buffer.slice(summaryEnd + '</summary>'.length);
          }
          mode = 'reasoning';
          closeTag = next.closeTag;
          continue;
        }

        mode = 'reasoning';
        closeTag = next.closeTag;
      }

      return out;
    }

    return {
      feed(chunk) {
        return feedChunk(chunk);
      },
      flush() {
        const out = { reasoning: '', content: '' };
        if (!buffer) return out;
        if (mode === 'reasoning') out.reasoning = buffer;
        else if (mode === 'skip') {
          /* drop unfinished tool payload */
        } else out.content = buffer;
        buffer = '';
        mode = 'content';
        closeTag = '';
        return out;
      },
      isReasoning() {
        return mode === 'reasoning' || mode === 'skip';
      },
    };
  }

  Neura.reasoningSplitter = { createReasoningStreamSplitter };
})(window.Neura);
