// Development helper: browser checks against the running server.
module.exports = {
    testDir: __dirname,
    timeout: 60_000,
    expect: { timeout: 7_000 },
    fullyParallel: false,
    workers: 1,
    reporter: [['list']],
    use: {
        baseURL: `http://127.0.0.1:${process.env.APP_PUBLIC_PORT || 4173}`,
        viewport: { width: 1280, height: 800 },
        trace: 'off',
    },
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
};
