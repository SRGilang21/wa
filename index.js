const {
    default: makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    downloadContentFromMessage
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs').promises;
const path = require('path');

const userStates = {};

async function ensureFoldersExist() {
    await fs.mkdir('./sessions', { recursive: true });
    await fs.mkdir('./temp', { recursive: true });
}

async function connectToWhatsApp() {
    await ensureFoldersExist();
    const { state, saveCreds } = await useMultiFileAuthState('sessions');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('🔑 Scan QR berikut:');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            switch (reason) {
                case DisconnectReason.badSession:
                case DisconnectReason.loggedOut:
                    console.log('❌ Session error. Hapus folder sessions dan scan ulang QR.');
                    process.exit();
                default:
                    console.log('🔁 Reconnecting...');
                    connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('✅ Terhubung ke WhatsApp!');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const type = Object.keys(msg.message)[0];
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

        await sock.readMessages([msg.key]);

        if (!userStates[from]) {
            userStates[from] = {
                awaitingImages: false,
                imageBuffers: [],
                awaitingFileName: false,
                quotedMessageId: null
            };
        }

        // 📷 Terima gambar
        if (type === 'imageMessage') {
            try {
                const stream = await downloadContentFromMessage(msg.message.imageMessage, 'image');
                let buffer = Buffer.alloc(0);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                if (!userStates[from].awaitingImages) {
                    userStates[from].awaitingImages = true;
                    userStates[from].imageBuffers = [];
                }

                userStates[from].imageBuffers.push(buffer);
                userStates[from].quotedMessageId = msg.key.id;

                await sock.sendMessage(from, {
                    text: `📸 Gambar diterima (${userStates[from].imageBuffers.length}). Kirim lagi atau ketik *selesai* untuk buat PDF.`
                }, { quoted: msg });

            } catch (err) {
                console.error('❌ Gagal download gambar:', err);
                await sock.sendMessage(from, { text: 'Gagal memproses gambar.' });
            }

        // 📝 Perintah selesai
        } else if (text.trim().toLowerCase() === 'selesai' && userStates[from].imageBuffers.length > 0) {
            userStates[from].awaitingImages = false;
            userStates[from].awaitingFileName = true;

            await sock.sendMessage(from, {
                text: '📄 Sekarang kirimkan *nama file PDF* (tanpa "nama:" ya).'
            });

        // 📄 Terima nama file dan mulai proses
        } else if (userStates[from].awaitingFileName) {
            const fileName = text.trim().replace(/[^a-zA-Z0-9\s_-]/g, '') || null;

            // ✅ Kirim info awal
            await sock.sendMessage(from, {
                text: `⏳ Membuat PDF dari ${userStates[from].imageBuffers.length} gambar. Harap tunggu sebentar...`
            });

            await convertMultipleImagesToPdf(from, userStates[from].imageBuffers, fileName, sock, userStates[from].quotedMessageId);

            // Reset state
            userStates[from] = {
                awaitingImages: false,
                imageBuffers: [],
                awaitingFileName: false,
                quotedMessageId: null
            };

        // 🧠 Perkenalan awal
        } else if (text.toLowerCase() === 'halo') {
            await sock.sendMessage(from, {
                text: 'Halo! Kirim beberapa gambar ke saya, lalu ketik *selesai* untuk mengubahnya menjadi PDF. Setelah itu, kirim nama file PDF-nya.'
            });
        }
    });
}

// 🔄 Fungsi menggabungkan gambar ke PDF
async function convertMultipleImagesToPdf(from, imageBuffers, fileName, sock, quotedMessageId) {
    try {
        const pdfDoc = await PDFDocument.create();

        for (const buffer of imageBuffers) {
            let image;
            try {
                image = await pdfDoc.embedJpg(buffer);
            } catch {
                image = await pdfDoc.embedPng(buffer);
            }

            const page = pdfDoc.addPage([image.width, image.height]);
            page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
        }

        const pdfBytes = await pdfDoc.save();
        const safeName = fileName || `gambar-${Date.now()}`;
        const finalName = safeName + '.pdf';
        const filePath = path.join('./temp', finalName);

        await fs.writeFile(filePath, pdfBytes);

        await sock.sendMessage(from, {
            document: { url: filePath },
            mimetype: 'application/pdf',
            fileName: finalName
        }, {
            quoted: { key: { remoteJid: from, id: quotedMessageId, fromMe: false }, message: {} }
        });

        // ✅ Kirim info akhir
        await sock.sendMessage(from, { text: `✅ PDF "${finalName}" berhasil dibuat dan dikirim!` });
        await fs.unlink(filePath);
    } catch (err) {
        console.error('❌ Gagal konversi PDF:', err);
        await sock.sendMessage(from, { text: `❌ Gagal membuat PDF: ${err.message}` });
    }
}

connectToWhatsApp();
