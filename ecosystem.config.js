module.exports = {
  apps: [{
    name: 'wiw',
    script: 'server.js',
    // Baris ini PENTING:
    // Memaksa PM2 untuk menjalankan skrip dari direktori ini
    cwd: '/root/wiw/',
  }]
};
