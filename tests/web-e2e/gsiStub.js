// Stands in for https://accounts.google.com/gsi/client. A test may set window.__gsiToken to hand out a fresh token.
window.google = {
  accounts: {
    oauth2: {
      initTokenClient(cfg) {
        return {
          requestAccessToken() {
            setTimeout(() => cfg.callback({ access_token: window.__gsiToken || 'test-token', expires_in: 3600 }), 10)
          }
        }
      }
    }
  }
}
