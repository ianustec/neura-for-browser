/**
 * Browser-automation tools, the extra that agent mode adds on top of a normal
 * chat. They are declared to Open WebUI as a direct tool server and executed
 * here in the extension (see browser-tool-bridge.js); everything else in a turn
 * stays server-side.
 * @type {Array<{ type: 'function', function: { name: string, description: string, parameters: object } }>}
 */
export const NEURA_AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'read_dom_snapshot',
      description:
        'Read visible text from the page (title, URL, meta description, main/article/body text). Optionally scope to a CSS selector.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'Optional CSS selector to scope content' },
          max_length: { type: 'number', description: 'Max characters (default 8000)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'query_elements',
      description: 'List up to N elements matching a CSS selector (tag, id, short text, visibility).',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector' },
          limit: { type: 'number', description: 'Max nodes (default 20)' },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_element_text',
      description: 'Get textContent of the nth element matching selector (0-based).',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          nth: { type: 'number', description: 'Index, default 0' },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'click_element',
      description: 'Scroll element into view and click the nth match of selector.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          nth: { type: 'number' },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fill_input',
      description:
        'Set value on input/textarea/contenteditable; dispatches input/change for React/autocomplete. Use press_enter:true after search fields (Google Maps, etc.) to confirm autocomplete. For Google Maps suggestions you can also click_element on .pac-item (nth 0).',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          value: { type: 'string' },
          append: { type: 'boolean', description: 'Append instead of replace' },
          press_enter: { type: 'boolean', description: 'Press Enter after filling (autocomplete/search)' },
          nth: { type: 'number' },
        },
        required: ['selector', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'press_key',
      description:
        'Send a keyboard key to the focused element or a specific element. Use Enter to confirm autocomplete, ArrowDown/ArrowUp to navigate suggestions, Escape to dismiss.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            enum: ['Enter', 'ArrowDown', 'ArrowUp', 'Tab', 'Escape'],
            description: 'Key to press',
          },
          selector: { type: 'string', description: 'Optional element to focus before pressing' },
          nth: { type: 'number' },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'focus_element',
      description: 'Focus the nth element matching selector.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          nth: { type: 'number' },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scroll_to',
      description: 'Scroll an element into view, or scroll window to y position.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          y: { type: 'number', description: 'Pixel top when selector omitted' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_form',
      description: 'Submit a form via requestSubmit() or submit().',
      parameters: {
        type: 'object',
        properties: {
          form_selector: { type: 'string', description: 'CSS selector for form' },
        },
        required: ['form_selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wait_for_selector',
      description: 'Wait until selector appears in DOM (polling).',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string' },
          timeout_ms: { type: 'number' },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate_same_origin',
      description:
        'Navigate current tab to URL only if same-origin as current page (full URL or path). Waits until ready; then use read_dom_snapshot before answering about the new page.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'take_screenshot',
      description:
        'Capture a PNG of the visible tab and show it to the user. The tool result is a short confirmation only (no image bytes). ' +
        'After capturing, use read_dom_snapshot or query_elements to inspect structure and selectors. ' +
        'A screenshot is an observation for the current task — never treat it as a new request to describe the page.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_maps_directions',
      description:
        'Open Google Maps driving/walking/transit directions in the current tab. Prefer this over clicking the Maps UI when the user asks for route directions. Origin is optional (Maps uses current location if omitted).',
      parameters: {
        type: 'object',
        properties: {
          destination: { type: 'string', description: 'Destination address or place name' },
          origin: { type: 'string', description: 'Origin address or place name (optional)' },
          travelmode: {
            type: 'string',
            enum: ['driving', 'walking', 'transit', 'bicycling'],
            description: 'Travel mode (default driving)',
          },
        },
        required: ['destination'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate',
      description:
        'Navigate current tab to an absolute URL (same- or cross-origin). Waits until the page is ready. After success, call read_dom_snapshot before summarizing the new page.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_new_tab',
      description: 'Open URL in a new browser tab (requires user approval).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          active: { type: 'boolean', description: 'Focus new tab (default true)' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'download_file',
      description:
        'Save a file from a URL to the user\'s own disk (requires user approval). ' +
        'This is a one-way action for the USER\'s benefit only: it never returns the ' +
        'file\'s content, so it must NEVER be used to try to read/analyze a document. ' +
        'To read or analyze the content of a file (PDF, DOCX, spreadsheet, etc.), use ' +
        'the workspace/integration tool that can fetch and return its actual text.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          filename: { type: 'string', description: 'Optional suggested filename' },
        },
        required: ['url'],
      },
    },
  },
];

/** @type {Record<string, { kind: 'page' | 'browser', needsConfirm?: boolean | string }>} */
export const TOOL_META = {
  read_dom_snapshot: { kind: 'page' },
  query_elements: { kind: 'page' },
  get_element_text: { kind: 'page' },
  click_element: { kind: 'page' },
  fill_input: { kind: 'page' },
  press_key: { kind: 'page' },
  focus_element: { kind: 'page' },
  scroll_to: { kind: 'page' },
  submit_form: { kind: 'page' },
  wait_for_selector: { kind: 'page' },
  navigate_same_origin: { kind: 'browser' },
  take_screenshot: { kind: 'browser' },
  open_maps_directions: { kind: 'browser' },
  navigate: { kind: 'browser' },
  open_new_tab: { kind: 'browser', needsConfirm: true },
  download_file: { kind: 'browser', needsConfirm: true },
};

/**
 * A browser automation is anything that acts on the user's own browser: reading
 * or driving the active tab, navigating, capturing it, saving a file to disk.
 * Only these run inside the extension; every other tool of a turn — workspace,
 * MCP, Open WebUI built-ins — belongs to the server, exactly as in a normal chat.
 * @param {string | null | undefined} name
 * @returns {boolean}
 */
export function isBrowserToolName(name) {
  const kind = TOOL_META[String(name || '')]?.kind;
  return kind === 'page' || kind === 'browser';
}
