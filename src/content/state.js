(function (Neura) {
  Neura.state = {
    sessionMessagesLoaded: false,
    streamingPort: null,
    currentStreamingMessageElement: null,
    currentStreamingMessageWrapper: null,
    currentStreamingContent: '',
    currentStreamingMessageDiv: null,
    autoScrollEnabled: true,
    suppressFocusUntil: 0,
    lastMessageAreaInteractionAt: 0,
    lastMessageAreaScrollAt: 0,
    globalKeyHandlerDisabled: false,
    agentMode: false,
    selectedToolIds: [],
    selectedToolsMeta: [],
    enabledKnowledgeIds: [],
    featureToggles: {
      web_search: false,
      image_generation: false,
      code_interpreter: false,
      memory: false,
    },
    agentRunning: false,
    agentLogPanel: null,
    agentLogChips: null,
    agentLogStatus: null,
    agentLogPort: null,
    agentChipStack: [],
    theme: 'system',
    sidebarOpen: false,
    dictateActive: false,
    /** @type {'chat'|'note'} */
    panelMode: 'chat',
    activeNoteId: null,
  };
  Neura.constants = {
    SCROLL_BOTTOM_THRESHOLD: 40,
    MIN_CHAT_WIDTH: 200,
    MIN_CHAT_HEIGHT: 100,
    SIDEBAR_WIDTH_PX: 860,
    MAX_CHAT_WIDTH_RATIO: 0.9,
  };
})(window.Neura);
