export const SEL = {
  // Setup
  setupWizard: '[data-testid="setup-wizard"]',
  setupStepAdmin: '[data-testid="setup-step-admin"]',
  setupStepTmdb: '[data-testid="setup-step-tmdb"]',
  setupStepRd: '[data-testid="setup-step-rd"]',
  setupStepProfile: '[data-testid="setup-step-profile"]',

  // Auth
  loginForm: '[data-testid="admin-login-form"]',
  usernameInput: '[data-testid="username-input"]',
  passwordInput: '[data-testid="password-input"]',

  // Profiles
  profileGrid: '[data-testid="profile-grid"]',
  profileCard: '[data-testid="profile-card"]',
  pinInput: '[data-testid="pin-input"]',
  pinError: '[data-testid="pin-error"]',

  // Admin Panel
  addProfileBtn: '[data-testid="add-profile-btn"]',
  addProfileForm: '[data-testid="add-profile-form"]',
  newProfileName: '[data-testid="new-profile-name"]',
  newProfilePin: '[data-testid="new-profile-pin"]',
  createProfileBtn: '[data-testid="create-profile-btn"]',
  profileList: '[data-testid="profile-list"]',
  profileRow: '[data-testid="profile-row"]',
  logoutBtn: '[data-testid="logout-btn"]',
  rdApiKeyInput: '[data-testid="rd-api-key-input"]',
  tmdbApiKeyInput: '[data-testid="tmdb-api-key-input"]',
  saveSettingsBtn: '[data-testid="save-settings-btn"]',
  settingsMsg: '[data-testid="settings-msg"]',

  // Search
  searchBar: '[data-testid="search-bar"]',
  searchBtn: '[data-testid="search-btn"]',
  resultsGrid: '[data-testid="results-grid"]',
  resultCard: '[data-testid="result-card"]',
  recentlyViewed: '[data-testid="recently-viewed"]',
  noResults: '[data-testid="no-results"]',

  // Streams
  streamPicker: '[data-testid="stream-picker"]',
  streamRow: '[data-testid="stream-row"]',
  filterResolution: '[data-testid="filter-resolution"]',
  filterHdr: '[data-testid="filter-hdr"]',
  deviceSelector: '[data-testid="device-selector"]',
  downloadBtn: '[data-testid="download-btn"]',

  // Downloads
  activeDownloads: '[data-testid="active-downloads"]',
  queuedDownloads: '[data-testid="queued-downloads"]',
  downloadHistory: '[data-testid="download-history"]',
  downloadsEmpty: '[data-testid="downloads-empty"]',
  activeDownloadCard: '[data-testid="active-download-card"]',
  progressBar: '[data-testid="progress-bar"]',
  cancelBtn: '[data-testid="cancel-btn"]',

  // Devices
  deviceList: '[data-testid="device-list"]',
  deviceCard: '[data-testid="device-card"]',
  pairBtn: '[data-testid="pair-device-btn"]',
  pairingCode: '[data-testid="pairing-code"]',

  // Navigation
  sidebar: '[data-testid="sidebar"]',
  navSearch: '[data-testid="nav-search"]',
  navDownloads: '[data-testid="nav-downloads"]',
  navDevices: '[data-testid="nav-devices"]',
  navSettings: '[data-testid="nav-settings"]',
  connectionStatus: '[data-testid="connection-status"]',
  profileName: '[data-testid="profile-name"]',

  // Settings
  setPinBtn: '[data-testid="set-pin-btn"]',
  pinMsg: '[data-testid="pin-msg"]',
  switchProfileBtn: '[data-testid="switch-profile-btn"]',
  adminPanelBtn: '[data-testid="admin-panel-btn"]',

  // Toasts
  toast: '[data-testid="toast"]',
  toastClose: '[data-testid="toast-close"]',

  // Tabs
  tabAll: '[data-testid="tab-all"]',
  tabActive: '[data-testid="tab-active"]',
  tabQueued: '[data-testid="tab-queued"]',
  tabCompleted: '[data-testid="tab-completed"]',
  tabFailed: '[data-testid="tab-failed"]',
} as const;
