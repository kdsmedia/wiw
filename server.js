import { GoogleGenerativeAI } from "@google/generative-ai";
import * as fs from 'node:fs/promises';
import 'dotenv/config';
import qrcode from 'qrcode-terminal';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;

// --- File Paths ---
const USERS_DB_PATH = './users.json';
const TASKS_DB_PATH = './tasks.json';
const CONFIG_PATH = './config.json';
const SHOP_DB_PATH = './shop.json';
const RIDDLES_DB_PATH = './riddles.json';

class Storage {
    static async read(filePath) { try { await fs.access(filePath); const data = await fs.readFile(filePath, 'utf-8'); return JSON.parse(data); } catch (error) { return null; } }
    static async write(filePath, data) { await fs.writeFile(filePath, JSON.stringify(data, null, 2)); }
}

class AltoBot {
    constructor() {
        this.client = new Client({
            authStrategy: new LocalAuth(),
            puppeteer: { headless: true, args: ['--no-sandbox'] },
            webVersionCache: { type: 'remote', remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html' }
        });
        this.genAI = null; this.userChats = new Map(); this.users = {}; this.tasks = []; this.shopItems = []; this.riddles = []; this.config = {}; this.ownerNumber = "6285813899649";
    }

    async initialize() {
        console.log("🚀 Memulai inisialisasi ALTO Bot...");
        await this.loadData();
        this.initializeAI();
        this.setupWhatsAppEvents();
        this.client.initialize();
    }

    async loadData() {
        this.config = await Storage.read(CONFIG_PATH) || { adminPassword: 'admin123', dailyBonus: { min: 100, max: 500 } };
        this.users = await Storage.read(USERS_DB_PATH) || {};
        this.tasks = await Storage.read(TASKS_DB_PATH) || [];
        this.shopItems = await Storage.read(SHOP_DB_PATH) || [];
        this.riddles = await Storage.read(RIDDLES_DB_PATH) || [];
        console.log("✅ Data berhasil dimuat.");
    }

    initializeAI() {
        if (!process.env.API_KEY) { console.error("\n❌ ERROR: Environment variable API_KEY tidak diatur."); process.exit(1); }
        try { this.genAI = new GoogleGenerativeAI(process.env.API_KEY); console.log("✅ AI Berhasil Diinisialisasi."); } catch (error) { console.error("❌ Gagal menginisialisasi AI:", error); process.exit(1); }
    }
    
    setupWhatsAppEvents() {
        this.client.on('qr', qr => { qrcode.generate(qr, { small: true }); });
        this.client.on('ready', () => { console.log('✅ ALTO Bot terhubung dan siap menerima pesan!'); });
        this.client.on('message', this.handleMessage.bind(this));
    }

    async handleMessage(message) {
        const userId = message.from;
        let user = this.users[userId];
        const input = message.body.trim();

        if (!user) {
            user = { balance: 0, isBlocked: false, lastLogin: new Date().toDateString(), claimedDailyBonus: false, completedTasksToday: [], isAdmin: false, captchaState: { isWaiting: false }, inGame: false, gameData: null, state: 'main', miningPower: 1, energy: 100, withdrawData: {}, activeTask: null };
            this.users[userId] = user;
            await Storage.write(USERS_DB_PATH, this.users);
            message.reply(`👋 Halo! Selamat datang di ALTO Bot. Akun baru telah dibuat untukmu.`);
            this.showMenu(message, user);
            return;
        }

        if (user.isBlocked) return;

        const today = new Date().toDateString();
        if (user.lastLogin !== today) { user.lastLogin = today; user.claimedDailyBonus = false; user.completedTasksToday = []; }

        if (input.toLowerCase() === '00' || input.toLowerCase() === '/menu') {
            user.state = 'main'; user.inGame = false; user.captchaState = { isWaiting: false }; user.activeTask = null;
            await Storage.write(USERS_DB_PATH, this.users);
            this.showMenu(message, user);
            return;
        }
         if (input.toLowerCase() === '0' || input.toLowerCase() === '/batal') {
            user.state = 'main'; user.inGame = false; user.captchaState = { isWaiting: false }; user.activeTask = null;
            await Storage.write(USERS_DB_PATH, this.users);
            message.reply("Aksi dibatalkan.");
            this.showMenu(message, user);
            return;
        }
        
        if (user.captchaState.isWaiting) { await this.verifyCaptcha(message, user, input); return; }
        if (user.inGame) { await this.handleGameInput(message, user, input); return; }
        if (user.state.startsWith('withdraw_')) { await this.handleWithdrawInput(message, user, input); return; }
        if (user.state === 'memilih_tugas') { await this.handleTaskSelection(message, user, input); return; }
        if (user.state === 'memilih_game') { await this.handleGameSelection(message, user, input); return; }

        if (user.state === 'main') {
            const choice = parseInt(input);
            if (!isNaN(choice)) {
                switch (choice) {
                    case 1: this.showProfile(message, user); break;
                    case 2: await this.startWithdrawProcess(message, user); break;
                    case 3: await this.handleClaim(message, user); break;
                    case 4: await this.handleListAvailableTasks(message, user); break;
                    case 5: await this.showGameMenu(message, user); break;
                    case 6: await this.showShopMenu(message, user); break;
                    case 7: this.showOwnerInfo(message, user); break;
                    case 8: await this.handleClearHistory(message, user); break;
                    default: message.reply("Pilihan tidak valid."); break;
                }
            } else if (input.startsWith('/')) {
                const args = input.split(' ').slice(1);
                const commandName = input.toLowerCase().split(' ')[0];
                await this.handleAdminCommands(message, user, commandName, args);
            } else {
                await this.getAiResponse(message);
            }
        }
    }

    showMenu(message, user) {
        let menu = `==============================
------------ 🏠 MENU UTAMA ---------------
==============================

1. 👤 Profil
2. 🏦 Withdraw
3. 🎁 Klaim Bonus Harian
4. 📝 Lihat & Kerjakan Tugas
5. 🎮 Main Game
6. 🛒 Shop (Olshop Pilihan)
7. 📞 Hubungi Owner
8. 🤖 Hapus Riwayat Obrolan

==============================
*Balas dengan nomor pilihan Anda (contoh: 1)*
==============================`;
        if (user.isAdmin) { menu += `\n\n--- 👑 MENU ADMIN ---\nGunakan perintah seperti biasa (contoh: */listusers*).`; }
        message.reply(menu);
    }
    
    showProfile(message, user) {
        const profileText = `==============================
---------------------- PROFIL ---------------------
==============================

👤: ${message.from.split('@')[0]}
💰: Rp.${user.balance}

==============================
*0* untuk kembali
==============================`;
        message.reply(profileText);
    }

    async startWithdrawProcess(message, user) {
        user.state = 'withdraw_amount'; user.withdrawData = {};
        await Storage.write(USERS_DB_PATH, this.users);
        const withdrawText = `==============================
------------------- WITHDRAW -----------------
==============================

💰 Saldo Anda: Rp.${user.balance}

*Ketik nominal penarikan (contoh: 10000)*

==============================
*0* untuk kembali
*00* untuk ke menu utama
==============================`;
        message.reply(withdrawText);
    }
    
    async handleWithdrawInput(message, user, input) {
        switch(user.state) {
            case 'withdraw_amount':
                const amount = parseInt(input);
                if (isNaN(amount) || amount <= 0) { message.reply("Nominal tidak valid. Harap masukkan angka saja."); return; }
                if (amount > user.balance) { message.reply(`Saldo tidak cukup. Saldo Anda: Rp.${user.balance}`); return; }
                user.withdrawData.amount = amount; user.state = 'withdraw_bank';
                await Storage.write(USERS_DB_PATH, this.users);
                message.reply(`Nominal: Rp.${amount}\n\n*Ketik nama bank (contoh: bca/bri/dana/ovo/gopay)*`);
                break;
            case 'withdraw_bank':
                user.withdrawData.bank = input; user.state = 'withdraw_name';
                await Storage.write(USERS_DB_PATH, this.users);
                message.reply(`Bank: ${input}\n\n*Ketik nama pemilik rekening*`);
                break;
            case 'withdraw_name':
                user.withdrawData.name = input; user.state = 'withdraw_number';
                await Storage.write(USERS_DB_PATH, this.users);
                message.reply(`Nama: ${input}\n\n*Ketik nomor rekening/telepon*`);
                break;
            case 'withdraw_number':
                user.withdrawData.number = input; user.state = 'main';
                user.balance -= user.withdrawData.amount;
                await Storage.write(USERS_DB_PATH, this.users);
                const notification = `--- 🏦 PERMINTAAN WITHDRAW ---\nUser: ${message.from.split('@')[0]}\nJumlah: Rp.${user.withdrawData.amount}\nBank: ${user.withdrawData.bank}\nNama: ${user.withdrawData.name}\nNo. Rek: ${user.withdrawData.number}\n\nHarap segera diproses.`;
                this.client.sendMessage(`${this.ownerNumber}@c.us`, notification);
                message.reply("✅ Permintaan withdraw Anda telah dikirim ke admin untuk diproses. Saldo Anda telah dipotong. Terima kasih!");
                this.showMenu(message, user);
                break;
        }
    }

    async handleClaim(message, user) {
        if (user.claimedDailyBonus) { message.reply("Anda sudah mengklaim bonus harian hari ini. Coba lagi besok."); return; }
        const captchaText = this.generateCaptcha();
        user.captchaState = { isWaiting: true, type: 'claim', answer: captchaText };
        await Storage.write(USERS_DB_PATH, this.users);
        const claimText = `==============================
----------------- KLAIM BONUS ---------------
==============================

Ketik kode captcha di bawah ini untuk klaim bonus harian:

*Kode: ${captchaText}*

==============================
*0* untuk kembali
*00* untuk ke menu utama
==============================`;
        message.reply(claimText);
    }

    async handleListAvailableTasks(message, user) {
        const availableTasks = this.tasks.filter(task => !user.completedTasksToday.includes(task.id));
        if (availableTasks.length === 0) { message.reply("Tidak ada tugas yang tersedia saat ini."); this.showMenu(message, user); return; }
        let taskList = `==============================
---------- 📝 DAFTAR TUGAS ----------
==============================\n\n`;
        availableTasks.forEach(task => { taskList += `*${task.id}.* ${task.name}\n*Hadiah:* Rp.${task.reward} | *Durasi:* ${task.duration} menit\n\n`; });
        taskList += `==============================
*Balas dengan nomor tugas untuk memulai*
*0* untuk kembali
*00* untuk ke menu utama
==============================`;
        user.state = 'memilih_tugas';
        await Storage.write(USERS_DB_PATH, this.users);
        message.reply(taskList);
    }

    async handleTaskSelection(message, user, input) {
        const taskId = parseInt(input);
        const task = this.tasks.find(t => t.id === taskId);
        user.state = 'main';
        if (!task) { message.reply("Pilihan tidak valid."); this.showMenu(message, user); await Storage.write(USERS_DB_PATH, this.users); return; }
        if (user.activeTask) { message.reply(`Anda masih memiliki tugas aktif: "${this.tasks.find(t => t.id === user.activeTask.id)?.name}". Selesaikan dulu dengan mengetik */selesai ${user.activeTask.id}*`); await Storage.write(USERS_DB_PATH, this.users); return; }
        user.activeTask = { id: taskId, startTime: Date.now() };
        await Storage.write(USERS_DB_PATH, this.users);
        const taskInstruction = `Tugas dimulai: *${task.name}*\n\n${task.description}\n\n*Link Tugas:* ${task.link}\n\nAnda harus menunggu *${task.duration} menit*. Setelah itu, ketik */selesai ${task.id}* untuk verifikasi dan klaim hadiah Anda.`;
        message.reply(taskInstruction);
    }

    async handleSelesai(message, user, taskIdStr) {
        const taskId = parseInt(taskIdStr);
        if (isNaN(taskId)) { message.reply("Gunakan format */selesai [id_tugas]*. Contoh: */selesai 1*"); return; }
        if (!user.activeTask || user.activeTask.id !== taskId) { message.reply("Anda tidak sedang mengerjakan tugas ini atau tugas sudah selesai."); return; }
        const task = this.tasks.find(t => t.id === taskId);
        const timeElapsed = Date.now() - user.activeTask.startTime;
        const requiredTime = task.duration * 60 * 1000;
        if (timeElapsed < requiredTime) {
            const remainingTime = Math.ceil((requiredTime - timeElapsed) / 60000);
            message.reply(`Waktu tugas belum selesai. Harap tunggu sekitar *${remainingTime} menit* lagi.`);
            return;
        }
        const captchaText = this.generateCaptcha();
        user.captchaState = { isWaiting: true, type: 'task', task: task, answer: captchaText };
        user.activeTask = null;
        await Storage.write(USERS_DB_PATH, this.users);
        const taskCaptchaText = `==============================
--------- VERIFIKASI TUGAS ---------
==============================

Untuk menyelesaikan tugas *"${task.name}"*,
Ketik kode captcha di bawah ini:

*Kode: ${captchaText}*

==============================
*0* untuk kembali
*00* untuk ke menu utama
==============================`;
        message.reply(taskCaptchaText);
    }

    async showGameMenu(message, user) {
        user.state = 'memilih_game';
        await Storage.write(USERS_DB_PATH, this.users);
        const gameMenuText = `==============================
---------- 🎮 PILIH GAME ----------
==============================

Pilih game yang ingin kamu mainkan:

1. 🔢 Game Tebak Angka
2. 🤔 Game Teka Teki Mudah

==============================
*Balas dengan nomor pilihan Anda*
*0* untuk kembali
==============================`;
        message.reply(gameMenuText);
    }
    
    async handleGameSelection(message, user, input) {
        const choice = parseInt(input);
        user.state = 'main';
        switch(choice) {
            case 1: await this.startGame(message, user); break;
            case 2: await this.startRiddleGame(message, user); break;
            default: message.reply("Pilihan tidak valid."); this.showMenu(message, user); break;
        }
    }

    async startGame(message, user) {
        user.inGame = true;
        user.gameData = { type: 'tebak_angka', answer: Math.floor(Math.random() * 100) + 1 };
        await Storage.write(USERS_DB_PATH, this.users);
        const gameText = `==============================
------- 🔢 GAME TEBAK ANGKA -------
==============================

Saya telah memilih angka antara 1 dan 100. Coba tebak!

==============================
*Ketik tebakan Anda (contoh: 50)*
*0* untuk menyerah & kembali
==============================`;
        message.reply(gameText);
    }

    async startRiddleGame(message, user) {
        if (this.riddles.length === 0) { message.reply("Maaf, persediaan teka-teki sedang kosong."); this.showMenu(message, user); return; }
        const riddle = this.riddles[Math.floor(Math.random() * this.riddles.length)];
        user.inGame = true;
        user.gameData = { type: 'teka_teki', answer: riddle.answer };
        await Storage.write(USERS_DB_PATH, this.users);
        const riddleText = `==============================
------- 🤔 GAME TEKA TEKI -------
==============================

Jawab teka-teki berikut:

*${riddle.question}*

==============================
*Ketik jawaban Anda*
*0* untuk menyerah & kembali
==============================`;
        message.reply(riddleText);
    }
    
    async handleGameInput(message, user, input) {
        if (input === '0') {
            user.inGame = false; user.gameData = null;
            await Storage.write(USERS_DB_PATH, this.users);
            message.reply("Anda telah keluar dari game.");
            this.showMenu(message, user);
            return;
        }
        const gameData = user.gameData;
        let isCorrect = false;
        if (gameData.type === 'tebak_angka') {
            const guess = parseInt(input);
            if (isNaN(guess)) { message.reply("🤖 Masukkan angka yang valid!"); return; }
            if (guess < gameData.answer) { message.reply("🤖 Terlalu rendah! Coba lagi."); return; }
            if (guess > gameData.answer) { message.reply("🤖 Terlalu tinggi! Coba lagi."); return; }
            isCorrect = true;
        } else if (gameData.type === 'teka_teki') {
            if (input.toLowerCase().trim() === gameData.answer.toLowerCase()) { isCorrect = true; } 
            else { message.reply("Jawaban salah, coba lagi!"); return; }
        }
        if (isCorrect) {
            const reward = gameData.type === 'tebak_angka' ? 250 : 300;
            user.balance += reward; user.inGame = false; user.gameData = null;
            await Storage.write(USERS_DB_PATH, this.users);
            const successText = `==============================
🎉 SELAMAT, ANDA BENAR! 🎉
==============================

Jawabannya adalah *${gameData.answer}*.
Anda mendapatkan *${reward}* saldo!

==============================
Saldo baru Anda: Rp.${user.balance}
==============================`;
            message.reply(successText);
            this.showMenu(message, user);
        }
    }

    async showShopMenu(message, user) {
        if (this.shopItems.length === 0) { message.reply("Daftar Olshop sedang kosong."); return; }
        let shopText = `==============================
OLSHOP PILIHAN
==============================\n\n`;
        this.shopItems.forEach(item => { shopText += `${item.id}. Belanja disini (${item.url})\n`; });
        shopText += `\n==============================
0. Kembali
==============================`;
        message.reply(shopText);
    }
    
    showOwnerInfo(message, user) {
        const ownerText = `==============================
---------- 📞 HUBUNGI OWNER ----------
==============================

Anda dapat menghubungi owner/admin melalui WhatsApp di nomor berikut:

*${this.ownerNumber}*

==============================
*0* untuk kembali
*00* untuk ke menu utama
==============================`;
        message.reply(ownerText);
    }

    async handleClearHistory(message, user) {
        this.userChats.delete(message.from);
        const confirmationText = `==============================
------- 🤖 RIWAYAT DIHAPUS -------
==============================

Riwayat obrolan Anda dengan AI telah berhasil dihapus.`;
        await message.reply(confirmationText);
        this.showMenu(message, user);
    }

    generateCaptcha(length = 6) { return Math.random().toString(36).substring(2, 2 + length).toUpperCase(); }

    async verifyCaptcha(message, user, userInput) {
        const { type, task, answer, timerId } = user.captchaState;
        if (timerId) clearTimeout(timerId);
        user.captchaState = { isWaiting: false };
        if (userInput.trim().toUpperCase() === answer) {
            message.reply("✅ Verifikasi berhasil!");
            if (type === 'task') {
                user.balance += task.reward;
                user.completedTasksToday.push(task.id);
                message.reply(`🎉 Selamat! Anda mendapatkan ${task.reward} saldo. Saldo baru: ${user.balance}.`);
            } else if (type === 'claim') {
                const { min, max } = this.config.dailyBonus;
                const reward = Math.floor(Math.random() * (max - min + 1)) + min;
                user.balance += reward; user.claimedDailyBonus = true;
                message.reply(`🎉 Selamat! Anda mendapatkan bonus harian ${reward} saldo. Saldo baru: ${user.balance}`);
            }
        } else {
            message.reply("❌ Verifikasi salah. Proses dibatalkan.");
        }
        await Storage.write(USERS_DB_PATH, this.users);
        this.showMenu(message, user);
    }

    async getAiResponse(message) {
        try {
            const userId = message.from;
            if (!this.userChats.has(userId)) {
                 const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash", systemInstruction: "Kamu adalah ALTO, bot WhatsApp yang ramah dan membantu. Selalu balas dalam Bahasa Indonesia. Jangan gunakan format markdown." });
                this.userChats.set(userId, model.startChat());
            }
            const chat = this.userChats.get(userId);
            const result = await chat.sendMessage(message.body);
            const response = await result.response;
            message.reply(response.text().trim());
        } catch (error) {
            console.error("\n❌ Gemini API error:", error);
            message.reply("🤖 Maaf, ALTO sedikit sibuk. Coba lagi nanti.");
        }
    }

    // --- BAGIAN ADMIN DIMULAI DI SINI ---
    checkAdmin(message, user) {
        if (!user.isAdmin) {
            message.reply("❌ Perintah ini hanya untuk admin.");
            return false;
        }
        return true;
    }

    async handleAdminCommands(message, user, commandName, args) {
        if (!user.isAdmin && commandName !== '/loginadmin') {
            if (commandName.startsWith('/')) { message.reply("Perintah tidak dikenali. Coba /menu."); }
            else { await this.getAiResponse(message); }
            return;
        }

        switch (commandName) {
            case '/loginadmin': this.handleLoginAdmin(message, user, args[0]); break;
            case '/listusers': if (this.checkAdmin(message, user)) this.handleListUsers(message, user); break;
            case '/blockuser': if (this.checkAdmin(message, user)) await this.handleBlockUser(message, user, args[0]); break;
            case '/unblockuser': if (this.checkAdmin(message, user)) await this.handleUnblockUser(message, user, args[0]); break;
            case '/deleteuser': if (this.checkAdmin(message, user)) await this.handleDeleteUser(message, user, args[0]); break;
            case '/addtugas': if (this.checkAdmin(message, user)) await this.handleAddTugas(message, user, args); break;
            case '/listtugas': if (this.checkAdmin(message, user)) this.handleListAllTasks(message, user); break;
            case '/hapustugas': if (this.checkAdmin(message, user)) await this.handleDeleteTask(message, user, args[0]); break;
            case '/setbonus': if (this.checkAdmin(message, user)) await this.handleSetBonus(message, user, args[0], args[1]); break;
            default: if (commandName.startsWith('/')) { message.reply("Perintah admin tidak dikenali."); } break;
        }
    }

    handleLoginAdmin(message, user, password) {
        if (password === this.config.adminPassword) {
            user.isAdmin = true;
            Storage.write(USERS_DB_PATH, this.users);
            message.reply("👑 Anda berhasil masuk sebagai admin.");
        } else {
            message.reply("❌ Kata sandi admin salah.");
        }
    }

    handleListUsers(message, user) {
        let userList = "--- 👥 Daftar Pengguna ---\n";
        for (const id in this.users) {
            const u = this.users[id];
            userList += `*ID:* ${id.split('@')[0]}\n*Saldo:* ${u.balance}\n*Diblokir:* ${u.isBlocked}\n\n`;
        }
        message.reply(userList);
    }
    
    async handleBlockUser(message, user, userIdToBlock) {
        if (!userIdToBlock) { message.reply("Penggunaan: /blockuser <nomor>"); return; }
        const targetId = userIdToBlock.endsWith('@c.us') ? userIdToBlock : `${userIdToBlock}@c.us`;
        if (this.users[targetId]) {
            this.users[targetId].isBlocked = true;
            await Storage.write(USERS_DB_PATH, this.users);
            message.reply(`✅ Pengguna ${targetId.split('@')[0]} telah diblokir.`);
        } else {
            message.reply(`❌ Pengguna ${userIdToBlock} tidak ditemukan.`);
        }
    }
    
    async handleUnblockUser(message, user, userIdToUnblock) {
        if (!userIdToUnblock) { message.reply("Penggunaan: /unblockuser <nomor>"); return; }
        const targetId = userIdToUnblock.endsWith('@c.us') ? userIdToUnblock : `${userIdToUnblock}@c.us`;
        if (this.users[targetId]) {
            this.users[targetId].isBlocked = false;
            await Storage.write(USERS_DB_PATH, this.users);
            message.reply(`✅ Blokir untuk pengguna ${targetId.split('@')[0]} telah dibuka.`);
        } else {
            message.reply(`❌ Pengguna ${userIdToUnblock} tidak ditemukan.`);
        }
    }

    async handleDeleteUser(message, user, userIdToDelete) {
        if (!userIdToDelete) { message.reply("Penggunaan: /deleteuser <nomor>"); return; }
        const targetId = userIdToDelete.endsWith('@c.us') ? userIdToDelete : `${userIdToDelete}@c.us`;
        if (this.users[targetId]) {
            delete this.users[targetId];
            await Storage.write(USERS_DB_PATH, this.users);
            message.reply(`✅ Pengguna ${targetId.split('@')[0]} telah dihapus.`);
        } else {
            message.reply(`❌ Pengguna ${userIdToDelete} tidak ditemukan.`);
        }
    }

    async handleAddTugas(message, user, args) {
        const [rewardStr, durationStr, name, link, ...descParts] = args;
        const reward = parseInt(rewardStr);
        const duration = parseInt(durationStr);
        const description = descParts.join(' ');
        if (isNaN(reward) || isNaN(duration) || !name || !link || !description || duration <= 0) {
            message.reply("Penggunaan salah: /addtugas <hadiah> <durasi> <nama> <link> <deskripsi>");
            return;
        }
        const newId = this.tasks.length > 0 ? Math.max(...this.tasks.map(t => t.id)) + 1 : 1;
        this.tasks.push({ id: newId, reward, duration, name, link, description });
        await Storage.write(TASKS_DB_PATH, this.tasks);
        message.reply(`✅ Tugas baru ditambahkan dengan ID: ${newId}.`);
    }

    handleListAllTasks(message, user) {
        if (this.tasks.length === 0) { message.reply("Belum ada tugas yang dibuat."); return; }
        let taskList = "--- 📝 Semua Tugas ---\n";
        this.tasks.forEach(task => { taskList += `*ID:* ${task.id} | *Bonus:* ${task.reward} | *Durasi:* ${task.duration} menit\n*Nama:* ${task.name}\n\n`; });
        message.reply(taskList);
    }
    
    async handleDeleteTask(message, user, taskIdStr) {
        if (!taskIdStr) { message.reply("Penggunaan: /hapustugas <id>"); return; }
        const taskId = parseInt(taskIdStr);
        const taskIndex = this.tasks.findIndex(t => t.id === taskId);
        if (taskIndex > -1) {
            this.tasks.splice(taskIndex, 1);
            await Storage.write(TASKS_DB_PATH, this.tasks);
            message.reply(`✅ Tugas dengan ID ${taskId} telah dihapus.`);
        } else {
            message.reply("❌ Tugas dengan ID tersebut tidak ditemukan.");
        }
    }
    
    async handleSetBonus(message, user, minStr, maxStr) {
        const min = parseInt(minStr);
        const max = parseInt(maxStr);
        if (isNaN(min) || isNaN(max) || min > max) {
            message.reply("Penggunaan salah. Contoh: /setbonus 100 500");
            return;
        }
        this.config.dailyBonus = { min, max };
        await Storage.write(CONFIG_PATH, this.config);
        message.reply(`✅ Bonus klaim harian telah diatur ke rentang ${min} - ${max}.`);
    }
}

const bot = new AltoBot();
bot.initialize();
