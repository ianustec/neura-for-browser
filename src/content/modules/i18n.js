(function (Neura) {
  const SUPPORTED_LOCALES = ["it","en"];
  const LOCALE_LABELS = {
    "it": "Italiano",
    "en": "English"
  };

  const MESSAGES = {
    it: {
      copy: "Copia",
      copied: "Copiato!",
      copyMessageTooltip: "Copia il messaggio negli appunti",
      poweredByLabel: "Powered by",
      poweredByBrand: "IANUSTEC",
      poweredByLinkTitle: "Visita il sito IANUSTEC",
      error: "Errore",
      save: "Salva",
      cancel: "Annulla",
      editMessage: "Modifica messaggio",
      deleteMessage: "Elimina messaggio",
      stopGeneration: "Ferma generazione",
      sendMessage: "Invia messaggio",
      loading: "Caricamento...",
      ellipsis: "…",
      sources: (n) => `Fonti (${n})`,
      sourceDefault: "fonte",
      fileDefault: "file",
      thoughtActive: "Sto pensando…",
      thoughtWaiting: "Sto elaborando il ragionamento…",
      thoughtDoneOne: "Ragionato per 1 secondo",
      thoughtDoneMany: (n) => `Ragionato per ${n} secondi`,
      thoughtDoneSubSecond: "Ragionato per meno di un secondo",
      exploredTool: (name) => `Esplorato ${name}`,
      exploredTools: (list) => `Esplorato ${list}`,
      exploredPrefix: 'Esplorato',
      exploringPrefix: 'Esplorando',
      viewToolResult: (name) => `Visualizza risultato da ${name}`,
      toolInput: 'Input',
      toolOutput: 'Output',
      codeAnalyzed: 'Analizzato',
      codeAnalyzing: 'Analisi in corso…',
      statusThinking: "Sto pensando…",
      statusSearching: "Sto cercando…",
      statusDone: "Completato",
      navigating: "Navigando…",
      newSessionTitle: "Nuova chat",
      deleteChatTitle: "Elimina conversazione",
      settingsTitle: "Apri pannello impostazioni",
      closeSidebarTitle: "Chiudi sidebar",
      themeToggleToLight: "Passa al tema chiaro",
      themeToggleToDark: "Passa al tema scuro",
      contextPageTitle: "Usa il contesto di questa pagina",
      knowledgeTitle: "Accedi alla base di conoscenza aziendale",
      agentTitle: "Consenti al modello di usare i tool del browser (leggi/clicca/compila/naviga). Richiede function calling nativo.",
      togglePage: "Pagina",
      toggleScreenshot: "Screenshot",
      screenshotTitle: "Opzionale: invia uno screenshot della pagina con ogni messaggio (anche fuori da Agent). In Agent mode, se attivo, lo invia a ogni passo; se disattivo, il modello può chiederlo con take_screenshot.",
      toggleKnowledge: "Conoscenza",
      toggleAgent: "Agent",
      agentMenuTitle: "Agent e contesto",
      disableChip: "Disattiva",
      stopAgent: "Ferma agent",
      stopAgentTitle: "Ferma automazione browser",
      agentRunning: "Agent in esecuzione…",
      agentStep: (n) => `Agent · passo ${n}`,
      toggleMacro: "Registra skill",
      macroTitle: "Registra i passi dell'agente e crea una skill riutilizzabile",
      macroRecording: "REC · registrazione skill",
      macroRecOffNoSteps: "Nessun passo registrato da salvare come skill.",
      macroRecOnHint: "REC attivo: completa il workflow, poi disattiva REC per salvare la skill.",
      skillGenerating: "Analisi registrazione…",
      skillProposalTitle: "Nuova skill proposta",
      skillProposalSubtitle:
        "Rivedi nome, descrizione e istruzioni. Salva per tenerla o Scarta per ignorarla.",
      skillCreatedTitle: "Skill creata",
      skillCreatedSaved: "La skill è stata salvata. Puoi modificarla o rieseguirla con /.",
      skillCreatedUnsaved: "Rivedi e salva la skill generata.",
      skillNameLabel: "Nome",
      skillDescriptionLabel: "Descrizione (quando usarla)",
      skillCommandLabel: "Comando (senza /)",
      skillRecipeLabel: "Procedura (ricetta)",
      skillContentLabel: "Contenuto skill (skill.md)",
      skillDemonstrationLabel: "Dimostrazione registrata",
      skillDemonstrationEmpty: "Nessun passo registrato.",
      skillSave: "Salva",
      skillUpdate: "Aggiorna skill",
      skillDiscard: "Scarta",
      skillSaving: "Salvataggio…",
      skillSaved: "Skill salvata!",
      skillSaveError: "Errore nel salvataggio della skill.",
      skillMissingFields: "Compila nome, descrizione, comando e contenuto.",
      skillBadge: "SKILL",
      skillAgentPreamble: "Esegui la skill Neura seguendo le istruzioni sottostanti.",
      skillAgentWhen: (desc) => `Quando usarla: ${desc}`,
      skillAgentAskInputs:
        "IMPORTANTE: chiedi all'utente tutti gli input richiesti prima di usare tool browser o di integrazione, salvo che siano già nel messaggio.",
      skillAgentInputsProvided:
        "I valori sotto sono già stati forniti dall'utente tramite form: usali direttamente e non chiedere di nuovo salvo chiarimento.",
      skillAgentValuesHeader: "## Valori forniti dall'utente",
      skillAgentDecisionFlow:
        "IMPORTANTE: segui il flusso decisionale della skill (ricerche, permessi, rami if/else) — non riprodurre ciecamente la dimostrazione registrata.",
      skillInputOptional: "(opzionale)",
      skillInputsTitle: "Dati per la skill",
      skillInputsSubtitle: (name) =>
        `Compila i campi per eseguire${name ? ` «${name}»` : ' la skill'}.`,
      skillInputsRun: "Esegui skill",
      skillInputsCancel: "Annulla",
      skillInputsMissing: "Compila tutti i campi obbligatori.",
      mySkills: "Le mie skill",
      mySkillsHint: "Skill salvate sul server Open WebUI. Rilanciabili con / nel composer.",
      noSkills: "Nessuna skill salvata.",
      skillDelete: "Elimina skill",
      skillDeleteConfirm: (name) =>
        `Eliminare la skill${name ? ` «${name}»` : ''}? L'operazione non può essere annullata.`,
      skillDeleted: "Skill eliminata.",
      skillDeleteError: "Errore nell'eliminazione della skill.",
      confirmAction: "Conferma azione",
      allowActionPrompt: "Consentire questa azione?",
      confirmNavigate: "Naviga verso",
      confirmOpenTab: "Apri nuova scheda",
      confirmDownload: "Scarica file",
      deny: "Rifiuta",
      allow: "Consenti",
      errorPrefix: "Errore",
      generationStopped: "_⏹️ La generazione di questa risposta è stata fermata._",
      agentStopped: "_[Agent fermato dall'utente]_",
      responseInterrupted: "_⏹️ Risposta interrotta._",
      payloadTruncated: "\n\n[...contenuto troncato per dimensioni payload...]",
      deleteConfirmTitle: "Conferma Cancellazione",
      deleteConfirmPage: (path) =>
        `Sei sicuro di voler cancellare la chat per questa pagina specifica?\n\n${path}`,
      deleteConfirmDomain: (domain) =>
        `Sei sicuro di voler cancellare la chat per tutto il dominio ${domain}?`,
      deleteChat: "Cancella Chat",
      settingsAccountTitle: "Account Neura",
      serverLabel: "Server Open WebUI",
      emailLabel: "Email / Username",
      emailPlaceholder: "La tua email Open WebUI",
      passwordLabel: "Password",
      passwordPlaceholder: "Password",
      login: "Accedi",
      loggingIn: "Accesso in corso...",
      logout: "Logout",
      modelLabel: "Modello",
      connectedAs: (name) => `Connesso come ${name}`,
      notConnected: "Non connesso. Accedi con le credenziali Open WebUI.",
      loginForModels: "Accedi per vedere i modelli",
      loadModels: "Caricamento modelli...",
      loginToLoadModels: "Accedi per caricare i modelli",
      privacyNote: "La password non viene mai salvata: solo il token di sessione resta su questo dispositivo (chrome.storage.local). Quando la sessione scade dovrai accedere di nuovo.",
      deleteAllChats: "Elimina tutte le Chat",
      deleteAllChatsConfirm:
        "Eliminare tutte le chat? Le chat fissate verranno conservate. Questa azione non può essere annullata.",
      deleteAllChatsDone: "Tutte le chat non fissate sono state eliminate.",
      deleteAllChatsPartial:
        "Alcune chat locali sono state eliminate, ma non è stato possibile completare l'eliminazione sul server. Potrebbero ricomparire al prossimo aggiornamento.",
      deleteAllChatsError: "Errore nell'eliminare le chat",
      newChat: "Nuova chat",
      searchChats: "Cerca chat...",
      pinnedChats: "Fissate",
      recentChats: "Recenti",
      noChats: "Nessuna chat",
      pinChat: "Fissa chat",
      unpinChat: "Rimuovi da fissate",
      deleteConfirmChat: "Eliminare questa conversazione da Open WebUI?",
      archivedChats: "Chat archiviate",
      noArchivedChats: "Nessuna chat archiviata",
      foldersSection: "Cartelle",
      deleteChatSidebar: "Elimina chat",
      tabRecent: "Recenti",
      tabPinned: "Fissate",
      tabArchived: "Archivio",
      tabFolders: "Cartelle",
      tabNotes: "Note",
      newNote: "Nuova nota",
      searchNotes: "Cerca note…",
      noNotes: "Nessuna nota",
      promptMentionEmpty: "Nessun prompt trovato",
      noteTitlePlaceholder: "Titolo nota",
      noteContentPlaceholder: "Scrivi in markdown…",
      noteSave: "Salva",
      noteDelete: "Elimina",
      noteBack: "Indietro",
      noteUntitled: "Senza titolo",
      noteLoading: "Caricamento nota…",
      noteLoadError: "Impossibile caricare la nota",
      noteSaving: "Salvataggio…",
      noteSaved: "Nota salvata",
      noteDeleteConfirm: "Eliminare questa nota?",
      noteDeleteError: "Impossibile eliminare la nota",
      chatOptions: "Opzioni chat",
      archiveChat: "Archivia",
      unarchiveChat: "Ripristina dall'archivio",
      duplicateChat: "Duplica",
      copyOfChat: (title) => `Copia di ${title}`,
      shareChat: "Condividi",
      shareLinkCopied: "Link di condivisione copiato negli appunti",
      addTag: "Aggiungi tag",
      addTagPrompt: "Nome del tag da aggiungere:",
      moveToFolder: "Sposta in cartella",
      moveToFolderPrompt: "Nome cartella (vuoto per rimuovere dalla cartella). Puoi usare percorsi tipo test/test1:",
      chatNotSyncedYet: "Questa chat non è ancora sincronizzata con il server: invia un messaggio prima di usare questa azione.",
      newFolder: "Nuova cartella",
      newFolderPrompt: "Nome della nuova cartella:",
      deleteFolder: "Elimina cartella",
      deleteFolderConfirm: "Eliminare questa cartella? Le chat al suo interno non verranno eliminate.",
      deleteFolderError: "Impossibile eliminare la cartella",
      folderOptions: "Opzioni cartella",
      duplicateFolder: "Duplica cartella",
      duplicateFolderError: "Impossibile duplicare la cartella",
      renameFolder: "Rinomina",
      renameFolderPrompt: "Nuovo nome della cartella:",
      renameFolderError: "Impossibile rinominare la cartella",
      newSubfolder: "Nuova sottocartella",
      newSubfolderPrompt: "Nome sottocartella (usa / per percorsi, es. a/b/c):",
      newFolderPathPrompt: "Nome cartella (usa / per percorsi annidati, es. test/test1/test2):",
      newFolderError: "Impossibile creare la cartella",
      moveFolder: "Sposta cartella",
      moveFolderPrompt: "Percorso cartella destinazione (vuoto = radice):",
      moveFolderError: "Impossibile spostare la cartella",
      folderNotFound: "Cartella non trovata",
      folderChatsSection: "Chat",
      noFolders: "Nessuna cartella",
      noFolderContents: "Cartella vuota",
      importedChatTitle: "Chat importata",
      importedChatBanner: "Le chat precedenti sono state importate da questo dispositivo.",
      syncRetryTitle: "Sincronizzazione in sospeso: clicca per riprovare subito",
      syncRetryFailed: "Sincronizzazione non riuscita, verrà ritentata automaticamente",
      generating: "Generazione…",
      toggleWebSearch: "Web",
      toggleCodeInterpreter: "Codice",
      toggleImageGen: "Immagini",
      webSearchTitle: "Attiva ricerca web",
      codeInterpreterTitle: "Attiva code interpreter",
      imageGenTitle: "Attiva generazione immagini",
      attachFile: "Allega file",
      attachFileTitle: "Allega un file dal dispositivo",
      attachPage: "Allega pagina",
      attachPageTitle: "Allega la pagina corrente come contesto",
      attachPageFailed: "Impossibile estrarre il contenuto della pagina",
      attachUploading: "Caricamento allegato…",
      attachOnlyMessage: "(allegato)",
      ingestPage: "Ingesti pagina",
      serverConnected: (v) => `Open WebUI ${v}`,
      serverProbeFailed: "Server non raggiungibile",
      serverProbing: "Verifica server in corso…",
      serverOk: (v) => `Connesso — Open WebUI ${v}`,
      serverFeaturesLabel: "Funzionalità",
      serverNotOwui: "Non sembra un'istanza Open WebUI valida.",
      serverProbeError: "Impossibile verificare il server",
      toolRunning: (n) => `Tool: ${n}`,
      toolDone: (n) => `${n} completato`,
      usageTokens: (n) => `${n} token`,
      codeInterpreterBlock: (lang) => `Code interpreter (${lang})`,
      streamErrorGeneric: "Errore durante lo streaming della risposta",
      messagePlaceholder: "Invia un messaggio…",
      toggleSidebar: "Mostra/nascondi cronologia chat",
      inputMenuTitle: "Allegati",
      integrationsMenuTitle: "Integrazioni",
      navSearch: "Cerca",
      navWorkspace: "Workspace",
      tabChats: "Chat",
      today: "Oggi",
      yesterday: "Ieri",
      thisWeek: "Questa settimana",
      older: "Precedenti",
      toolPickerTitle: "Tool",
      toolPickerMenuDesc: "Seleziona tool MCP e integrazioni server per la chat",
      toolPickerEmpty: "Nessun tool disponibile",
      toolPickerDone: "Fatto",
      activeToolsTitle: "Tool attivi",
      noActiveTools: "Nessun tool attivo",
      modelMentionEmpty: "Nessun modello trovato",
      knowledgeMentionEmpty: "Nessuna knowledge o file trovato",
      knowledgeMentionCollections: "Collections",
      knowledgeMentionFiles: "Files",
      knowledgeMentionRemove: "Rimuovi",
      toggleDictate: "Dictate",
      dictateTitle: "Dettatura: parla e il testo compare nell'input. Dopo ~1 secondo di silenzio il messaggio viene inviato (STT Open WebUI). Puoi anche dire «invia messaggio» alla fine, o cliccare di nuovo il microfono per fermarti.",
      voiceMicDenied: "Permesso microfono negato. Concedilo nel pannello e riprova.",
      voiceMicDeniedSettings:
        "Microfono bloccato per Neura. Abilitalo in chrome://settings/content/microphone e riprova.",
      voiceMicFailed: "Impossibile accedere al microfono",
      voiceSttFailed: "Trascrizione non riuscita. Verifica che STT sia configurato su Open WebUI.",
      voiceModeTitle: "Voice mode",
      voiceModeButtonTitle:
        "Voice mode: conversazione a voce con Neura. Parla, la risposta ti viene letta ad alta voce (STT/TTS Open WebUI).",
      voiceModeConnecting: "Connessione…",
      voiceModeListening: "Ti ascolto…",
      voiceModeTranscribing: "Sto trascrivendo…",
      voiceModeThinking: "Sto pensando…",
      voiceModeSpeaking: "Neura sta parlando",
      voiceModeMuted: "Microfono disattivato",
      voiceModeMute: "Disattiva microfono",
      voiceModeUnmute: "Riattiva microfono",
      voiceModeHangUp: "Chiudi voice mode",
      voiceModeInterrupt: "Interrompi",
      voiceModeInterruptHint: "Tocca la sfera per interrompere",
      voiceModeSendHint: "Parla, poi pausa breve — o tocca la sfera per inviare",
      voiceModeFailed: "Voice mode non disponibile. Riprova.",
      attachPageContextLabel: "Allega la pagina corrente come contesto",
      attachPageContextHint: "Se attivo, a ogni messaggio viene inviato al modello il contenuto della pagina che stai visitando, così può usarlo come contesto",
      micPermissionTitle: "Permesso microfono",
      uiLanguageLabel: "Lingua interfaccia",
      uiLanguageHint: "Lingua dei testi dell'estensione. Le modifiche vengono salvate automaticamente.",
      preferencesSaved: "Salvato",
      preferencesSaveError: "Errore nel salvare le preferenze"
    },
    en: {
      copy: "Copy",
      copied: "Copied!",
      copyMessageTooltip: "Copy message to clipboard",
      poweredByLabel: "Powered by",
      poweredByBrand: "IANUSTEC",
      poweredByLinkTitle: "Visit IANUSTEC website",
      error: "Error",
      save: "Save",
      cancel: "Cancel",
      editMessage: "Edit message",
      deleteMessage: "Delete message",
      stopGeneration: "Stop generation",
      sendMessage: "Send message",
      loading: "Loading...",
      ellipsis: "…",
      sources: (n) => `Sources (${n})`,
      sourceDefault: "source",
      fileDefault: "file",
      thoughtActive: "Thinking…",
      thoughtWaiting: "Processing reasoning…",
      thoughtDoneOne: "Thought for 1 second",
      thoughtDoneMany: (n) => `Thought for ${n} seconds`,
      thoughtDoneSubSecond: "Thought for less than a second",
      exploredTool: (name) => `Explored ${name}`,
      exploredTools: (list) => `Explored ${list}`,
      exploredPrefix: 'Explored',
      exploringPrefix: 'Exploring',
      viewToolResult: (name) => `View Result from ${name}`,
      toolInput: 'Input',
      toolOutput: 'Output',
      codeAnalyzed: 'Analyzed',
      codeAnalyzing: 'Analyzing…',
      statusThinking: "Thinking…",
      statusSearching: "Searching…",
      statusDone: "Done",
      navigating: "Navigating…",
      newSessionTitle: "New chat",
      deleteChatTitle: "Delete conversation",
      settingsTitle: "Open settings panel",
      closeSidebarTitle: "Close sidebar",
      themeToggleToLight: "Switch to light theme",
      themeToggleToDark: "Switch to dark theme",
      contextPageTitle: "Use this page as context",
      knowledgeTitle: "Access company knowledge base",
      agentTitle: "Allow the model to use browser tools (read/click/fill/navigate). Requires native function calling.",
      togglePage: "Page",
      toggleScreenshot: "Screenshot",
      screenshotTitle: "Optional: attach a page screenshot with every message (also outside Agent). In Agent mode, when on it is sent every step; when off, the model can request one via take_screenshot.",
      toggleKnowledge: "Knowledge",
      toggleAgent: "Agent",
      agentMenuTitle: "Agent & context",
      disableChip: "Turn off",
      stopAgent: "Stop agent",
      stopAgentTitle: "Stop browser automation",
      agentRunning: "Agent running…",
      agentStep: (n) => `Agent · step ${n}`,
      toggleMacro: "Record skill",
      macroTitle: "Record agent steps and create a reusable skill",
      macroRecording: "REC · recording skill",
      macroRecOffNoSteps: "No recorded steps to save as a skill.",
      macroRecOnHint: "REC on: complete the workflow, then turn REC off to save the skill.",
      skillGenerating: "Analyzing recording…",
      skillProposalTitle: "New skill proposal",
      skillProposalSubtitle:
        "Review name, description and instructions. Save to keep it or Dismiss to discard.",
      skillCreatedTitle: "Skill created",
      skillCreatedSaved: "The skill was saved. You can edit it or re-run it with /.",
      skillCreatedUnsaved: "Review and save the generated skill.",
      skillNameLabel: "Name",
      skillDescriptionLabel: "Description (when to use)",
      skillCommandLabel: "Command (without /)",
      skillRecipeLabel: "Procedure (recipe)",
      skillContentLabel: "Skill content (skill.md)",
      skillDemonstrationLabel: "Recorded demonstration",
      skillDemonstrationEmpty: "No steps recorded.",
      skillSave: "Save",
      skillUpdate: "Update skill",
      skillDiscard: "Dismiss",
      skillSaving: "Saving…",
      skillSaved: "Skill saved!",
      skillSaveError: "Failed to save the skill.",
      skillMissingFields: "Fill in name, description, command and content.",
      skillBadge: "SKILL",
      skillAgentPreamble: "Execute the Neura skill following the instructions below.",
      skillAgentWhen: (desc) => `When to use: ${desc}`,
      skillAgentAskInputs:
        "IMPORTANT: ask the user for all required inputs before using browser or integration tools, unless they are already in the message.",
      skillAgentInputsProvided:
        "The values below were provided by the user via form: use them directly and do not ask again unless clarification is needed.",
      skillAgentValuesHeader: "## Values provided by the user",
      skillAgentDecisionFlow:
        "IMPORTANT: follow the skill's decision flow (lookups, permissions, if/else branches) — do not blindly replay the recorded demonstration.",
      skillInputOptional: "(optional)",
      skillInputsTitle: "Skill inputs",
      skillInputsSubtitle: (name) =>
        `Fill in the fields to run${name ? ` “${name}”` : ' the skill'}.`,
      skillInputsRun: "Run skill",
      skillInputsCancel: "Cancel",
      skillInputsMissing: "Fill in all required fields.",
      mySkills: "My skills",
      mySkillsHint: "Skills saved on your Open WebUI server. Re-run them with / in the composer.",
      noSkills: "No saved skills.",
      skillDelete: "Delete skill",
      skillDeleteConfirm: (name) =>
        `Delete skill${name ? ` “${name}”` : ''}? This cannot be undone.`,
      skillDeleted: "Skill deleted.",
      skillDeleteError: "Failed to delete the skill.",
      confirmAction: "Confirm action",
      allowActionPrompt: "Allow this action?",
      confirmNavigate: "Navigate to",
      confirmOpenTab: "Open new tab",
      confirmDownload: "Download file",
      deny: "Deny",
      allow: "Allow",
      errorPrefix: "Error",
      generationStopped: "_⏹️ Generation of this response was stopped._",
      agentStopped: "_[Agent stopped by user]_",
      responseInterrupted: "_⏹️ Response interrupted._",
      payloadTruncated: "\n\n[...content truncated due to payload size...]",
      deleteConfirmTitle: "Confirm deletion",
      deleteConfirmPage: (path) =>
        `Are you sure you want to delete the chat for this specific page?\n\n${path}`,
      deleteConfirmDomain: (domain) =>
        `Are you sure you want to delete the chat for the entire domain ${domain}?`,
      deleteChat: "Delete chat",
      settingsAccountTitle: "Neura account",
      serverLabel: "Open WebUI server",
      emailLabel: "Email / Username",
      emailPlaceholder: "Your Open WebUI email",
      passwordLabel: "Password",
      passwordPlaceholder: "Password",
      login: "Sign in",
      loggingIn: "Signing in...",
      logout: "Logout",
      modelLabel: "Model",
      connectedAs: (name) => `Signed in as ${name}`,
      notConnected: "Not signed in. Use your Open WebUI credentials.",
      loginForModels: "Sign in to see models",
      loadModels: "Loading models...",
      loginToLoadModels: "Sign in to load models",
      privacyNote: "Your password is never saved: only the session token stays on this device (chrome.storage.local). When the session expires you'll need to sign in again.",
      deleteAllChats: "Delete all chats",
      deleteAllChatsConfirm:
        "Delete all chats? Pinned chats will be kept. This action cannot be undone.",
      deleteAllChatsDone: "All non-pinned chats have been deleted.",
      deleteAllChatsPartial:
        "Some local chats were deleted, but server deletion could not be completed. They may reappear on the next refresh.",
      deleteAllChatsError: "Error deleting chats",
      newChat: "New chat",
      searchChats: "Search chats…",
      pinnedChats: "Pinned",
      recentChats: "Recent",
      noChats: "No chats",
      pinChat: "Pin chat",
      unpinChat: "Unpin",
      deleteConfirmChat: "Delete this conversation from Open WebUI?",
      archivedChats: "Archived chats",
      noArchivedChats: "No archived chats",
      foldersSection: "Folders",
      deleteChatSidebar: "Delete chat",
      tabRecent: "Recent",
      tabPinned: "Pinned",
      tabArchived: "Archived",
      tabFolders: "Folders",
      tabNotes: "Notes",
      newNote: "New note",
      searchNotes: "Search notes…",
      noNotes: "No notes",
      promptMentionEmpty: "No prompts found",
      noteTitlePlaceholder: "Note title",
      noteContentPlaceholder: "Write in markdown…",
      noteSave: "Save",
      noteDelete: "Delete",
      noteBack: "Back",
      noteUntitled: "Untitled",
      noteLoading: "Loading note…",
      noteLoadError: "Could not load note",
      noteSaving: "Saving…",
      noteSaved: "Note saved",
      noteDeleteConfirm: "Delete this note?",
      noteDeleteError: "Could not delete note",
      chatOptions: "Chat options",
      archiveChat: "Archive",
      unarchiveChat: "Unarchive",
      duplicateChat: "Duplicate",
      copyOfChat: (title) => `Copy of ${title}`,
      shareChat: "Share",
      shareLinkCopied: "Share link copied to clipboard",
      addTag: "Add tag",
      addTagPrompt: "Name of the tag to add:",
      moveToFolder: "Move to folder",
      moveToFolderPrompt: "Folder name (empty to remove from folder). Paths like test/test1 are allowed:",
      chatNotSyncedYet: "This chat is not synced with the server yet: send a message first before using this action.",
      newFolder: "New folder",
      newFolderPrompt: "Name of the new folder:",
      deleteFolder: "Delete folder",
      deleteFolderConfirm: "Delete this folder? Chats inside it will not be deleted.",
      deleteFolderError: "Could not delete folder",
      folderOptions: "Folder options",
      duplicateFolder: "Duplicate folder",
      duplicateFolderError: "Could not duplicate folder",
      renameFolder: "Rename",
      renameFolderPrompt: "New folder name:",
      renameFolderError: "Could not rename folder",
      newSubfolder: "New subfolder",
      newSubfolderPrompt: "Subfolder name (use / for paths, e.g. a/b/c):",
      newFolderPathPrompt: "Folder name (use / for nested paths, e.g. test/test1/test2):",
      newFolderError: "Could not create folder",
      moveFolder: "Move folder",
      moveFolderPrompt: "Destination folder path (empty = root):",
      moveFolderError: "Could not move folder",
      folderNotFound: "Folder not found",
      folderChatsSection: "Chats",
      noFolders: "No folders",
      noFolderContents: "Empty folder",
      importedChatTitle: "Imported chat",
      importedChatBanner: "Previous chats were imported from this device.",
      syncRetryTitle: "Sync pending: click to retry now",
      syncRetryFailed: "Sync failed, it will be retried automatically",
      generating: "Generating…",
      serverProbing: "Checking server…",
      serverOk: (v) => `Connected — Open WebUI ${v}`,
      serverFeaturesLabel: "Features",
      serverNotOwui: "This does not appear to be a valid Open WebUI instance.",
      serverProbeFailed: "Server unreachable",
      serverProbeError: "Could not verify server",
      toggleWebSearch: "Web",
      toggleCodeInterpreter: "Code",
      toggleImageGen: "Images",
      webSearchTitle: "Enable web search",
      codeInterpreterTitle: "Enable code interpreter",
      imageGenTitle: "Enable image generation",
      toolPickerTitle: "Tools",
      toolPickerMenuDesc: "Select MCP tools and server integrations for this chat",
      toolPickerEmpty: "No tools available",
      toolPickerDone: "Done",
      activeToolsTitle: "Active tools",
      noActiveTools: "No active tools",
      toolRunning: (n) => `Running: ${n}…`,
      toolDone: (n) => `${n} completed`,
      usageTokens: (n) => `${n} tokens`,
      codeInterpreterBlock: (lang) => `Code interpreter (${lang})`,
      streamErrorGeneric: "Error while streaming the response",
      messagePlaceholder: "Send a message…",
      toggleSidebar: "Show/hide chat history",
      inputMenuTitle: "Attachments",
      integrationsMenuTitle: "Integrations",
      navSearch: "Search",
      navWorkspace: "Workspace",
      tabChats: "Chats",
      today: "Today",
      yesterday: "Yesterday",
      thisWeek: "This week",
      older: "Older",
      modelMentionEmpty: "No models found",
      knowledgeMentionEmpty: "No knowledge or files found",
      knowledgeMentionCollections: "Collections",
      knowledgeMentionFiles: "Files",
      knowledgeMentionRemove: "Remove",
      attachFile: "Attach file",
      attachFileTitle: "Attach a file from this device",
      attachPage: "Attach page",
      attachPageTitle: "Attach the current page as context",
      attachPageFailed: "Could not extract page content",
      attachUploading: "Uploading attachment…",
      attachOnlyMessage: "(attachment)",
      toggleDictate: "Dictate",
      dictateTitle: "Dictate: speak and the text appears in the input. After ~1 second of silence the message is sent (Open WebUI STT). You can also say “send message” at the end, or click the mic again to stop.",
      voiceMicDenied: "Microphone permission denied. Grant it in the panel and try again.",
      voiceMicDeniedSettings:
        "Microphone blocked for Neura. Enable it in chrome://settings/content/microphone and try again.",
      voiceMicFailed: "Could not access the microphone",
      voiceSttFailed: "Transcription failed. Check that STT is configured on Open WebUI.",
      voiceModeTitle: "Voice mode",
      voiceModeButtonTitle:
        "Voice mode: talk with Neura. Speak and the answer is read back (Open WebUI STT/TTS).",
      voiceModeConnecting: "Connecting…",
      voiceModeListening: "Listening…",
      voiceModeTranscribing: "Transcribing…",
      voiceModeThinking: "Thinking…",
      voiceModeSpeaking: "Neura is speaking",
      voiceModeMuted: "Microphone off",
      voiceModeMute: "Mute microphone",
      voiceModeUnmute: "Unmute microphone",
      voiceModeHangUp: "Close voice mode",
      voiceModeInterrupt: "Interrupt",
      voiceModeInterruptHint: "Tap the sphere to interrupt",
      voiceModeSendHint: "Speak, then a short pause — or tap the sphere to send",
      voiceModeFailed: "Voice mode is unavailable. Please try again.",
      attachPageContextLabel: "Attach the current page as context",
      attachPageContextHint: "When enabled, each message sends the content of the page you are viewing to the model so it can use it as context. Turn it off if you do not want to share the page text.",
      micPermissionTitle: "Microphone permission",
      ingestPage: "Ingest page",
      serverConnected: (v) => `Open WebUI ${v}`,
      uiLanguageLabel: "Interface language",
      uiLanguageHint: "Language of the extension UI. Changes are saved automatically.",
      preferencesSaved: "Saved",
      preferencesSaveError: "Error saving preferences"
    },
  };

  let locale = 'it';
  /** @type {Map<string, string>} */
  const translateCache = new Map();

  function normalizeLocale(raw) {
    const code = String(raw || 'it').toLowerCase().split('-')[0];
    return MESSAGES[code] ? code : 'it';
  }

  function resolveHostLocale() {
    const htmlLang = document.documentElement && document.documentElement.lang;
    if (htmlLang) return normalizeLocale(htmlLang);
    if (typeof navigator !== 'undefined' && navigator.language) {
      return normalizeLocale(navigator.language);
    }
    return 'it';
  }

  function lookup(key) {
    const bag = MESSAGES[locale] || MESSAGES.it;
    if (bag[key] != null) return bag[key];
    if (MESSAGES.en && MESSAGES.en[key] != null) return MESSAGES.en[key];
    if (MESSAGES.it && MESSAGES.it[key] != null) return MESSAGES.it[key];
    return null;
  }

  Neura.i18n = {
    SUPPORTED_LOCALES,
    LOCALE_LABELS,

    async init() {
      try {
        const stored = await new Promise((resolve) => {
          chrome.storage.sync.get(['neuraLocale'], (r) => resolve(r && r.neuraLocale));
        });
        if (stored) {
          locale = normalizeLocale(stored);
          return locale;
        }
      } catch (e) {
        /* ignore */
      }

      try {
        if (chrome.i18n && typeof chrome.i18n.getUILanguage === 'function') {
          locale = normalizeLocale(chrome.i18n.getUILanguage());
          return locale;
        }
      } catch (e) {
        /* ignore */
      }

      locale = resolveHostLocale();
      return locale;
    },

    getLocale() {
      return locale;
    },

    async setLocale(code) {
      locale = normalizeLocale(code);
      await new Promise((resolve) => {
        chrome.storage.sync.set({ neuraLocale: locale }, () => resolve());
      });
      return locale;
    },

    t(key, ...args) {
      const value = lookup(key);
      if (value == null) return key;
      return typeof value === 'function' ? value(...args) : value;
    },

    /**
     * Translate free-form text (e.g. server tool descriptions) into the UI locale.
     * Uses Chrome Translator / Language Detector when available; otherwise returns original.
     * @param {string} text
     * @returns {Promise<string>}
     */
    async translateToUiLocale(text) {
      const raw = String(text || '').trim();
      if (!raw) return '';

      const target = locale;
      const cacheKey = `${target}\0${raw}`;
      if (translateCache.has(cacheKey)) return translateCache.get(cacheKey);

      const TranslatorApi = globalThis.Translator;
      const DetectorApi = globalThis.LanguageDetector;
      if (typeof TranslatorApi === 'undefined' || typeof TranslatorApi.create !== 'function') {
        return raw;
      }

      let source = 'en';
      try {
        if (DetectorApi && typeof DetectorApi.create === 'function') {
          const detector = await DetectorApi.create();
          const results = await detector.detect(raw);
          const top = Array.isArray(results) && results[0];
          const detected = top && (top.detectedLanguage || top.language);
          if (detected && detected !== 'und') {
            source = String(detected).split('-')[0];
          }
          if (typeof detector.destroy === 'function') detector.destroy();
        }
      } catch (e) {
        /* keep default source */
      }

      if (source === target) {
        translateCache.set(cacheKey, raw);
        return raw;
      }

      try {
        let availability = 'available';
        if (typeof TranslatorApi.availability === 'function') {
          availability = await TranslatorApi.availability({
            sourceLanguage: source,
            targetLanguage: target,
          });
        }
        if (availability === 'unavailable') return raw;

        const translator = await TranslatorApi.create({
          sourceLanguage: source,
          targetLanguage: target,
        });
        const translated = await translator.translate(raw);
        if (typeof translator.destroy === 'function') translator.destroy();
        const out = String(translated || raw).trim() || raw;
        translateCache.set(cacheKey, out);
        return out;
      } catch (e) {
        return raw;
      }
    },

    localizeStatus(description) {
      const d = String(description || '').trim().toLowerCase();
      if (!d) return Neura.i18n.t('statusThinking');
      if (d.includes('think')) return Neura.i18n.t('statusThinking');
      if (d.includes('search')) return Neura.i18n.t('statusSearching');
      if (d.includes('navigat')) return Neura.i18n.t('navigating');
      if (d.includes('done') || d.includes('complete')) return Neura.i18n.t('statusDone');
      return description;
    },

    applyToShadowRoot(shadowRoot) {
      if (!shadowRoot) return;
      const host = shadowRoot.host;
      if (!host) return;
      host.lang = locale;
      host.setAttribute('translate', 'no');
    },
  };
})(window.Neura);
