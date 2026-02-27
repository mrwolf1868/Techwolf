
const express = require("express")
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } = require("@whiskeysockets/baileys")
const pino = require("pino")
const fs = require("fs")

const app = express()

// Cross-platform PORT handling
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080

async function startSession(number) {

    const sessionPath = "./sessions/" + number

    if (!fs.existsSync("./sessions")) {
        fs.mkdirSync("./sessions")
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath)
    const { version } = await fetchLatestBaileysVersion()

    const sock = makeWASocket({
        version,
        logger: pino({ level: "silent" }),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "silent" }))
        },
        browser: ["TECHWOLF", "Chrome", "1.0"]
    })

    sock.ev.on("creds.update", saveCreds)

    sock.ev.on("connection.update", (update) => {
        const { connection } = update
        if (connection === "open") {
            console.log("Connected: " + number)
        }
    })

    // ===== COMMAND SYSTEM =====

    sock.ev.on("messages.upsert", async (m) => {

        const msg = m.messages[0]
        if (!msg.message) return
        if (msg.key.fromMe) return

        const from = msg.key.remoteJid
        const isGroup = from.endsWith("@g.us")

        const body =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            ""

        const prefix = "."
        if (!body.startsWith(prefix)) return

        const args = body.slice(1).trim().split(/ +/)
        const command = args.shift().toLowerCase()

        const metadata = isGroup ? await sock.groupMetadata(from) : null
        const participants = isGroup ? metadata.participants : []
        const sender = msg.key.participant || from

        const isAdmin = isGroup
            ? participants.find(p => p.id === sender)?.admin !== null
            : false

        if (command === "ping") {
            sock.sendMessage(from, { text: "Pong 🏓" })
        }

        if (command === "alive") {
            sock.sendMessage(from, { text: "TECHWOLF is active ✅" })
        }

        if (command === "menu") {
            sock.sendMessage(from, {
                text: `
TECHWOLF MENU

.open
.close
.group
.tagall
.kick
.promote
.demote
.vcf
.addall
.ping
.alive
`
            })
        }

        if (command === "open" && isGroup && isAdmin) {
            await sock.groupSettingUpdate(from, "not_announcement")
            sock.sendMessage(from, { text: "Group opened." })
        }

        if (command === "close" && isGroup && isAdmin) {
            await sock.groupSettingUpdate(from, "announcement")
            sock.sendMessage(from, { text: "Group closed." })
        }

        if (command === "group" && isGroup) {
            sock.sendMessage(from, {
                text: `Name: ${metadata.subject}
Members: ${participants.length}`
            })
        }

        if (command === "tagall" && isGroup && isAdmin) {
            let text = "Tagging All:\n\n"
            let mentions = []
            participants.forEach(p => {
                text += `@${p.id.split("@")[0]}\n`
                mentions.push(p.id)
            })
            sock.sendMessage(from, { text, mentions })
        }

        if (command === "kick" && isGroup && isAdmin) {
            let mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid
            if (mentioned) await sock.groupParticipantsUpdate(from, mentioned, "remove")
        }

        if (command === "promote" && isGroup && isAdmin) {
            let mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid
            if (mentioned) await sock.groupParticipantsUpdate(from, mentioned, "promote")
        }

        if (command === "demote" && isGroup && isAdmin) {
            let mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid
            if (mentioned) await sock.groupParticipantsUpdate(from, mentioned, "demote")
        }

        if (command === "vcf" && isGroup && isAdmin) {
            let vcf = ""
            participants.forEach((p, i) => {
                const num = p.id.split("@")[0]
                vcf += `BEGIN:VCARD\nVERSION:3.0\nFN:Member ${i + 1}\nTEL;type=CELL;type=VOICE;waid=${num}:${num}\nEND:VCARD\n`
            })

            await sock.sendMessage(from, {
                document: Buffer.from(vcf),
                mimetype: "text/vcard",
                fileName: "group_contacts.vcf"
            })
        }

        if (command === "addall" && isGroup && isAdmin) {

            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage
            if (!quoted?.documentMessage) return

            const buffer = await sock.downloadMediaMessage({ message: quoted })
            const text = buffer.toString()
            const numbers = [...text.matchAll(/waid=(\d+)/g)].map(v => v[1])

            for (let num of numbers) {
                try {
                    await sock.groupParticipantsUpdate(
                        from,
                        [num + "@s.whatsapp.net"],
                        "add"
                    )
                    await new Promise(r => setTimeout(r, 1500))
                } catch {}
            }

            sock.sendMessage(from, { text: "Finished adding members." })
        }
    })

    if (!sock.authState.creds.registered) {
        return await sock.requestPairingCode(number)
    } else {
        return "Already Connected"
    }
}

// Web routes
app.get("/", (req, res) => {
    res.send("TECHWOLF Multi Web Pairing Running ✅<br>Use /pair?number=2547XXXXXXXX")
})

app.get("/pair", async (req, res) => {
    let number = req.query.number
    if (!number) return res.send("Use /pair?number=2547XXXXXXXX")

    number = number.replace(/[^0-9]/g, "")

    try {
        const code = await startSession(number)
        res.send("<h2>TECHWOLF Pairing Code:</h2><h1>" + code + "</h1>")
    } catch (err) {
        res.send("Error: " + err.message)
    }
})

// IMPORTANT: Bind to 0.0.0.0 for Railway & Katabump
app.listen(PORT, "0.0.0.0", () => {
    console.log("TECHWOLF Server running on port " + PORT)
})
