;const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const cheerio = require('cheerio');
const { Octokit } = require('@octokit/rest');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const { sms, downloadMediaMessage } = require("./msg");
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    S_WHATSAPP_NET
} = require('baileys');

const config = {
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'true',
    AUTO_LIKE_EMOJI: ['😒', '🍬', '💚', '💗', '🔥', '💥', '🥳', '❤️', '💕', '👨‍🔧'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/JCFSaopliBk7YvoxxuYDah?mode=wwc',
    ADMIN_LIST_PATH: './admin.json',
    RCD_IMAGE_PATH: './sulabot.jpg',
    NEWSLETTER_JID: '120363400387858467@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    OTP_EXPIRY: 300000,
    OWNER_NUMBER: '94767054052',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029Vb6tqliIHphOI6gvsh1X'
};

const octokit = new Octokit({ auth: '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' });
const owner = '𝘬𝘢𝘷𝘪𝘥𝘶 𝘪𝘯𝘥𝘶𝘸𝘢𝘳𝘢';
const repo = 'FREE-BOT-V1-PROJECT';

const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = './session';
const NUMBER_LIST_PATH = './numbers.json';
const otpStore = new Map();

if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

function loadAdmins() {
    try {
        if (fs.existsSync(config.ADMIN_LIST_PATH)) {
            return JSON.parse(fs.readFileSync(config.ADMIN_LIST_PATH, 'utf8'));
        }
        return [];
    } catch (error) {
        console.error('Failed to load admin list:', error);
        return [];
    }
}

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

function generateOTP() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

function getSriLankaTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}
// CREATE BY SHONU X MD 
async function cleanDuplicateFiles(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith(`empire_${sanitizedNumber}_`) && file.name.endsWith('.json')
        ).sort((a, b) => {
            const timeA = parseInt(a.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            const timeB = parseInt(b.name.match(/empire_\d+_(\d+)\.json/)?.[1] || 0);
            return timeB - timeA;
        });

        const configFiles = data.filter(file => 
            file.name === `config_${sanitizedNumber}.json`
        );

        if (sessionFiles.length > 1) {
            for (let i = 1; i < sessionFiles.length; i++) {
                await octokit.repos.deleteFile({
                    owner,
                    repo,
                    path: `session/${sessionFiles[i].name}`,
                    message: `Delete duplicate session file for ${sanitizedNumber}`,
                    sha: sessionFiles[i].sha
                });
                console.log(`Deleted duplicate session file: ${sessionFiles[i].name}`);
            }
        }

        if (configFiles.length > 0) {
            console.log(`Config file for ${sanitizedNumber} already exists`);
        }
    } catch (error) {
        console.error(`Failed to clean duplicate files for ${number}:`, error);
    }
}

async function joinGroup(socket) {
    let retries = config.MAX_RETRIES;
    const inviteCodeMatch = config.GROUP_INVITE_LINK.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
    if (!inviteCodeMatch) {
        console.error('Invalid group invite link format');
        return { status: 'failed', error: 'Invalid group invite link' };
    }
    const inviteCode = inviteCodeMatch[1];

    while (retries > 0) {
        try {
            const response = await socket.groupAcceptInvite(inviteCode);
            if (response?.gid) {
                console.log(`Successfully joined group with ID: ${response.gid}`);
                return { status: 'success', gid: response.gid };
            }
            throw new Error('No group ID in response');
        } catch (error) {
            retries--;
            let errorMessage = error.message || 'Unknown error';
            if (error.message.includes('not-authorized')) {
                errorMessage = 'Bot is not authorized to join (possibly banned)';
            } else if (error.message.includes('conflict')) {
                errorMessage = 'Bot is already a member of the group';
            } else if (error.message.includes('gone')) {
                errorMessage = 'Group invite link is invalid or expired';
            }
            console.warn(`Failed to join group, retries left: ${retries}`, errorMessage);
            if (retries === 0) {
                return { status: 'failed', error: errorMessage };
            }
            await delay(2000 * (config.MAX_RETRIES - retries));
        }
    }
    return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult) {
    const admins = loadAdmins();
    const groupStatus = groupResult.status === 'success'
        ? `Joined (ID: ${groupResult.gid})`
        : `Failed to join group: ${groupResult.error}`;
    const caption = formatMessage(
        '➼ 𝘒𝘈𝘝𝘐𝘋𝘜 𝘔𝘋 𝘔𝘐𝘕𝘐 𝘉𝘖𝘛 𝘚𝘜𝘊𝘚𝘚𝘌𝘚 ➼',!
        `🔰уσυ ηυмвєя ➟${number}\n👨‍🔧ѕтαтυѕ ➟ Connected ⚡`,
        `🔰 вσт νєяѕιση ➟1ν  ⚡`,
         `🔰 вσт σωηєя ➟ ƙαʋιԃυ ιɳԃυɯαɾ  υѕє < .σωηєя  > ⚡`,
        '𝘒𝘈𝘝𝘐𝘋𝘜-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- 💣💥'
    );

    for (const admin of admins) {
        try {
            await socket.sendMessage(
                `${admin}@s.whatsapp.net`,
                {
                    image: { url: config.RCD_IMAGE_PATH },
                    caption
                }
            );
        } catch (error) {
            console.error(`Failed to send connect message to admin ${admin}:`, error);
        }
    }
}

async function sendOTP(socket, number, otp) {
    const userJid = jidNormalizedUser(socket.user.id);
    const message = formatMessage(
        '🔰 OTP VERIFICATION',
        `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.`,
        '𝘒𝘈𝘝𝘐𝘋𝘜-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- 💣💥'
    );

    try {
        await socket.sendMessage(userJid, { text: message });
        console.log(`OTP ${otp} sent to ${number}`);
    } catch (error) {
        console.error(`Failed to send OTP to ${number}:`, error);
        throw error;
    }
}
function setupNewsletterHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== config.NEWSLETTER_JID) return;

        try {
            const emojis = ['💚', '🩷', '💐', '🥷🏻'];
            const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
            const messageId = message.newsletterServerId;

            if (!messageId) {
                console.warn('No valid newsletterServerId found:', message);
                return;
            }

            let retries = config.MAX_RETRIES;
            while (retries > 0) {
                try {
                    await socket.newsletterReactMessage(
                        config.NEWSLETTER_JID,
                        messageId.toString(),
                        randomEmoji
                    );
                    console.log(`Reacted to newsletter message ${messageId} with ${randomEmoji}`);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to react to newsletter message ${messageId}, retries left: ${retries}`, error.message);
                    if (retries === 0) throw error;
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
        } catch (error) {
            console.error('Newsletter reaction error:', error);
        }
    });
		}


async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant || message.key.remoteJid === config.NEWSLETTER_JID) return;

        try {
            if (config.AUTO_RECORDING === 'true' && message.key.remoteJid) {
                await socket.sendPresenceUpdate("recording", message.key.remoteJid);
            }

            if (config.AUTO_VIEW_STATUS === 'true') {
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.readMessages([message.key]);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to read status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }

            if (config.AUTO_LIKE_STATUS === 'true') {
                const randomEmoji = config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)];
                let retries = config.MAX_RETRIES;
                while (retries > 0) {
                    try {
                        await socket.sendMessage(
                            message.key.remoteJid,
                            { react: { text: randomEmoji, key: message.key } },
                            { statusJidList: [message.key.participant] }
                        );
                        console.log(`Reacted to status with ${randomEmoji}`);
                        break;
                    } catch (error) {
                        retries--;
                        console.warn(`Failed to react to status, retries left: ${retries}`, error);
                        if (retries === 0) throw error;
                        await delay(1000 * (config.MAX_RETRIES - retries));
                    }
                }
            }
        } catch (error) {
            console.error('Status handler error:', error);
        }
    });
}

async function handleMessageRevocation(socket, number) {
    socket.ev.on('messages.delete', async ({ keys }) => {
        if (!keys || keys.length === 0) return;

        const messageKey = keys[0];
        const userJid = jidNormalizedUser(socket.user.id);
        const deletionTime = getSriLankaTimestamp();
        
        const message = formatMessage(
            '🗑😒 MESSAGE DELETED',
            `A message was deleted from your chat.\n🥺 From: ${messageKey.remoteJid}\n👨‍🔧 Deletion Time: ${deletionTime}`,
            '𝘒𝘈𝘝𝘐𝘋𝘜-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- 💣💥'
        );

        try {
            await socket.sendMessage(userJid, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: message
            });
            console.log(`Notified ${number} about message deletion: ${messageKey.id}`);
        } catch (error) {
            console.error('Failed to send deletion notification:', error);
        }
    });
}

async function resize(image, width, height) {
    let oyy = await Jimp.read(image);
    let kiyomasa = await oyy.resize(width, height).getBufferAsync(Jimp.MIME_JPEG);
    return kiyomasa;
}

function capital(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

const createSerial = (size) => {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}
async function oneViewmeg(socket, isOwner, msg ,sender) {
    if (isOwner) {  
    try {
    const akuru = sender
    const quot = msg
    if (quot) {
        if (quot.imageMessage?.viewOnce) {
            console.log("hi");
            let cap = quot.imageMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.imageMessage);
            await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
        } else if (quot.videoMessage?.viewOnce) {
            console.log("hi");
            let cap = quot.videoMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.videoMessage);
             await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });
        } else if (quot.audioMessage?.viewOnce) {
            console.log("hi");
            let cap = quot.audioMessage?.caption || "";
            let anu = await socke.downloadAndSaveMediaMessage(quot.audioMessage);
             await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
        } else if (quot.viewOnceMessageV2?.message?.imageMessage){
        
            let cap = quot.viewOnceMessageV2?.message?.imageMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2.message.imageMessage);
             await socket.sendMessage(akuru, { image: { url: anu }, caption: cap });
            
        } else if (quot.viewOnceMessageV2?.message?.videoMessage){
        
            let cap = quot.viewOnceMessageV2?.message?.videoMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2.message.videoMessage);
            await socket.sendMessage(akuru, { video: { url: anu }, caption: cap });

        } else if (quot.viewOnceMessageV2Extension?.message?.audioMessage){
        
            let cap = quot.viewOnceMessageV2Extension?.message?.audioMessage?.caption || "";
            let anu = await socket.downloadAndSaveMediaMessage(quot.viewOnceMessageV2Extension.message.audioMessage);
            await socket.sendMessage(akuru, { audio: { url: anu }, caption: cap });
        }
        }        
        } catch (error) {
      }
    }

}

function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

const type = getContentType(msg.message);
    if (!msg.message) return	
  msg.message = (getContentType(msg.message) === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
	const m = sms(socket, msg);
	const quoted =
        type == "extendedTextMessage" &&
        msg.message.extendedTextMessage.contextInfo != null
          ? msg.message.extendedTextMessage.contextInfo.quotedMessage || []
          : []
        const body = (type === 'conversation') ? msg.message.conversation 
    : msg.message?.extendedTextMessage?.contextInfo?.hasOwnProperty('quotedMessage') 
        ? msg.message.extendedTextMessage.text 
    : (type == 'interactiveResponseMessage') 
        ? msg.message.interactiveResponseMessage?.nativeFlowResponseMessage 
            && JSON.parse(msg.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson)?.id 
    : (type == 'templateButtonReplyMessage') 
        ? msg.message.templateButtonReplyMessage?.selectedId 
    : (type === 'extendedTextMessage') 
        ? msg.message.extendedTextMessage.text 
    : (type == 'imageMessage') && msg.message.imageMessage.caption 
        ? msg.message.imageMessage.caption 
    : (type == 'videoMessage') && msg.message.videoMessage.caption 
        ? msg.message.videoMessage.caption 
    : (type == 'buttonsResponseMessage') 
        ? msg.message.buttonsResponseMessage?.selectedButtonId 
    : (type == 'listResponseMessage') 
        ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
    : (type == 'messageContextInfo') 
        ? (msg.message.buttonsResponseMessage?.selectedButtonId 
            || msg.message.listResponseMessage?.singleSelectReply?.selectedRowId 
            || msg.text) 
    : (type === 'viewOnceMessage') 
        ? msg.message[type]?.message[getContentType(msg.message[type].message)] 
    : (type === "viewOnceMessageV2") 
        ? (msg.msg.message.imageMessage?.caption || msg.msg.message.videoMessage?.caption || "") 
    : '';
	 	let sender = msg.key.remoteJid;
	  const nowsender = msg.key.fromMe ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) : (msg.key.participant || msg.key.remoteJid)
          const senderNumber = nowsender.split('@')[0]
          const developers = `${config.OWNER_NUMBER}`;
          const botNumber = socket.user.id.split(':')[0]
          const isbot = botNumber.includes(senderNumber)
          const isOwner = isbot ? isbot : developers.includes(senderNumber)
          var prefix = config.PREFIX
	  var isCmd = body.startsWith(prefix)
    	  const from = msg.key.remoteJid;
          const isGroup = from.endsWith("@g.us")
	      const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '.';
          var args = body.trim().split(/ +/).slice(1)
socket.downloadAndSaveMediaMessage = async(message, filename, attachExtension = true) => {
                let quoted = message.msg ? message.msg : message
                let mime = (message.msg || message).mimetype || ''
                let messageType = message.mtype ? message.mtype.replace(/Message/gi, '') : mime.split('/')[0]
                const stream = await downloadContentFromMessage(quoted, messageType)
                let buffer = Buffer.from([])
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk])
                }
                let type = await FileType.fromBuffer(buffer)
                trueFileName = attachExtension ? (filename + '.' + type.ext) : filename
                await fs.writeFileSync(trueFileName, buffer)
                return trueFileName
}
        if (!command) return;
        
        let pinterestCache = {}; //

        try {
            switch (command) {
       case 'alive': {
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    const captionText = `
*𝙆𝘼𝙑𝙄𝘿𝙐 𝙈𝘿 𝙈𝙄𝙉𝙄 𝘽𝙊𝙏 𝘼𝙇𝙄𝙑𝙀 𝙉𝙊𝙒 😚💗*

 ╭────❲𝘉𝘖𝘛 𝘕𝘖𝘞 𝘈𝘓𝘐𝘝𝘌❳────➣*
 │𝗕𝗢𝗧 𝗨𝗣 𝗧𝗜𝗠𝗘 ➟ ${hours}h ${minutes}m ${seconds}s* 
 │𝗕𝗢𝗧𝗔𝗖𝗧𝗜𝗩𝗘 𝗖𝗢𝗨𝗡𝗧➟ ${activeSockets.size}* 
 │𝗠𝗜𝗡𝗜 𝗩𝗘𝗥𝗦𝗜𝗢𝗡 ➟ 1.0.0 ᴠ* 
 │𝗗𝗘𝗣𝗟𝗢𝗬 𝗣𝗟𝗔𝗧𝗙𝗥𝗢𝗠 ➟ [ VPS ]* 
 │𝗠𝗜𝗡𝗜 𝗕𝗢𝗧 𝗢𝗪𝗡𝗘𝗥 ➟ 94767054052*
 ╰──────────➢*


➟ This is the result of our team's hard work.
Therefore, please respect the source and avoid unauthorized edits ◅

> 𝘒𝘈𝘝𝘐𝘋𝘜 𝘔𝘋 𝘔𝘐𝘕𝘐 𝘝1
`;

    const templateButtons = [
        {
            buttonId: `${config.PREFIX}menu`,
            buttonText: { displayText: '❲ 𝘔𝘌𝘕𝘜  📄 ❳' },
            type: 1,
        },
        {
            buttonId: `${config.PREFIX}owner`,
            buttonText: { displayText: ' ❲ 𝘖𝘞𝘕𝘌𝘙  👑 ❳' },
            type: 1,
        },
        {
            buttonId: 'action',
            buttonText: {
                displayText: ' ◅ ❤️👨‍🔧ᴍᴇɴᴜ ᴏᴘᴄᴛɪᴏɴꜱ ▻'
            },
            type: 4,
            nativeFlowInfo: {
                name: 'single_select',
                paramsJson: JSON.stringify({
                    title: 'TAB-AND-SELECTION ❕',
                    sections: [
                        {
                            title: ` ᴋᴀᴠɪᴅᴜ ᴍᴅ ᴍɪɴɪ ʙᴏᴛ 💣💥`,
                            highlight_label: '',
                            rows: [
                                {
                                    title: '❲ 𝘔𝘌𝘕𝘜  🔰 ❳',
                                    description: '',
                                    id: `${config.PREFIX}menu`,
                                },
                                {
                                    title: '❲ 𝘖𝘞𝘕𝘌𝘙 👑 ❳',
                                    description: 'ᴋᴀᴠɪᴅᴜ ᴍᴅ ᴍɪɴɪ ʙᴏᴛ 👨‍🔧⚡',
                                    id: `${config.PREFIX}owner`,
                                },
                            ],
                        },
                    ],
                }),
            },
        }
    ];

    await socket.sendMessage(m.chat, {
        buttons: templateButtons,
        headerType: 1,
        viewOnce: true,
        image: { url: "https://files.catbox.moe/0mwzza.jpg" },
        caption: ` 𝗞𝗔𝗩𝗜𝗗𝗨 𝗠𝗗 𝗠𝗜𝗡𝗜 𝗩1 💣💥\n\n${captionText}`,
    }, { quoted: msg });

    

  break;
		}
		case 'pair': {
    // ✅ Fix for node-fetch v3.x (ESM-only module)
    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const number = q.replace(/^[.\/!]pair\s*/i, '').trim();

    if (!number) {
        return await socket.sendMessage(sender, {
            text: '*📌 Usage:* .pair 9470604XXXX'
        }, { quoted: msg });
    }

    try {
        const url = `https://pair-7-cf7a9456011e.herokuapp.com/code?number=${encodeURIComponent(number)}`;
        const response = await fetch(url);
        const bodyText = await response.text();

        console.log("💗 API Response:", bodyText);

        let result;
        try {
            result = JSON.parse(bodyText);
        } catch (e) {
            console.error("❌ JSON Parse Error:", e);
            return await socket.sendMessage(sender, {
                text: '❌ Invalid response from server. Please contact support.'
            }, { quoted: msg });
        }

        if (!result || !result.code) {
            return await socket.sendMessage(sender, {
                text: '❌ Failed to retrieve pairing code. Please check the number.'
            }, { quoted: msg });
        }

        await socket.sendMessage(sender, {
            text: `> *𝗞𝗔𝗩𝗜𝗗𝗨 𝗠𝗗  𝐌𝙸𝙽𝙸 𝐁𝙾𝚃 𝐏𝙰𝙸𝚁 𝐂𝙾𝙼𝙿𝙻𝙴𝚃𝙴𝙳* ✅\n\n*🔑 Your pairing code is:* ${result.code}`
        }, { quoted: msg });

        await sleep(2000);

        await socket.sendMessage(sender, {
            text: `${result.code}`
        }, { quoted: msg });

    } catch (err) {
        console.error("❌ Pair Command Error:", err);
        await socket.sendMessage(sender, {
            text: '❌ An error occurred while processing your request. Please try again later.'
        }, { quoted: msg });
    }

    
    break;
}   

case 'menu': {
	
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    
const captionText = `


┌────🄱🄾🅃🄼🄴🄽🅄─────➣*
│𝘽𝙊𝙏 𝙐𝙋 𝙏𝙄𝙈𝙀 ➟ ${hours}h ${minutes}m ${seconds}s*
│𝘽𝙊𝙏𝘼𝘾𝙏𝙄𝙑𝙀 𝘾𝙊𝙐𝙉𝙏 ➟ *${activeSockets.size}*
│𝙈𝙄𝙉𝙄 𝙑𝙀𝙍𝙎𝙄𝙊𝙉 ➟ 1.0.0 ᴠ*
│𝙍𝘼𝙈 𝙐𝙎𝙀𝙂𝙀 ➟ 362520/320 GB*
│𝘿𝙀𝙋𝙇𝙊𝙔 𝙋𝙇𝘼𝙏𝙁𝙍𝙊𝙈 ➟ Heroku ❲ꜰʀᴇᴇ❳*
│𝙈𝙄𝙉𝙄 𝘽𝙊𝙏 𝙊𝙒𝙉𝙀𝙍 ➟ 94761332610*
└─────────➣*

> 𝙆𝘼𝙑𝙄𝘿𝙐 𝙈𝘿 𝙈𝙄𝙉𝙄 𝙑1 𝙈𝘼𝙄𝙉𝙈𝙀𝙉𝙐 🔰✗

*ＡＣＴＩＶＥ - ＦＵＬＬ- ＣＯＭＭＡＮＤ*

 ┌─────🄱🄾🅃🄲🄼🄳🄻🄸🅂🅃───⫸
❖│.𝗔𝗟𝗜𝗩𝗘 
❖│.𝗠𝗘𝗡𝗨
❖│.𝗢𝗪𝗡𝗘𝗥
❖│.𝗦𝗬𝗦𝗧𝗘𝗠 
❖│.𝗦𝗢𝗡𝗚 
❖│.𝗙𝗕 
❖│.𝗧𝗧  
❖│.𝗣𝗜𝗡𝗚 
❖│.𝗗𝗘𝗟𝗘𝗧𝗘𝗠𝗘 
 └───────────⫸

*Not all cmds work the same. I will give you all cmds in the next update.*

☛ ᴀᴜᴛᴏ ꜱᴛᴀᴛᴜꜱ ꜱᴇᴇɴ 
☛ ᴀᴜᴛᴏ ꜱᴛᴀᴛᴜꜱ ʀᴇᴀᴄᴛ
☛ ᴀᴜᴛᴏ ʀᴇᴄᴏᴅɪɴɢ ᴏɴ `;
	
    const templateButtons = [
        {
            buttonId: 'action',
            buttonText: {
                displayText: ' ◅ ❤️👨‍🔧ᴍᴇɴᴜ ᴏᴘᴄᴛɪᴏɴꜱ ▻'
            },
            type: 4,
            nativeFlowInfo: {
                name: 'single_select',
                paramsJson: JSON.stringify({
                    title: 'TAB-AND-SELECTION ❕',
                    sections: [
                        {
                            title: ` ᴋᴀᴠɪᴅᴜ ᴍᴅ ᴍɪɴɪ ʙᴏᴛ 💣💥`,
                            highlight_label: '',
                            rows: [
                                {
                                    title: '❲ 𝘋𝘖𝘞𝘕𝘓𝘖𝘈𝘋 𝘔𝘌𝘕𝘜  🔰 ❳',
                                    description: '',
                                    id: `${config.PREFIX}downloadmenu`,
                                },
								{
                                    title: '❲ 𝘍𝘜𝘕 𝘔𝘌𝘕𝘜  🔰 ❳',
                                    description: '',
                                    id: `${config.PREFIX}funmenu`,
                                },
								{
                                    title: '❲ 𝘎𝘙𝘖𝘜𝘗 𝘔𝘌𝘕𝘜  🔰 ❳',
                                    description: '',
                                    id: `${config.PREFIX}groupmenu`,
                                },
                                {
                                    title: '❲ 𝘖𝘞𝘕𝘌𝘙 𝘔𝘌𝘕𝘜 👑 ❳',
                                    description: 'ᴋᴀᴠɪᴅᴜ ᴍᴅ ᴍɪɴɪ ʙᴏᴛ 👨‍🔧⚡',
                                    id: `${config.PREFIX}ownermenu`,
                                },
                            ],
                        },
                    ],
                }),
            },
        }
    ];

    await socket.sendMessage(m.chat, {
        image: { url: "https://files.catbox.moe/0mwzza.jpg" },
        caption: captionText.trim(),
        footer: '*CREATE BY KAVIDU INDUWARA 🔰*',
        buttons: templateButtons,
        headerType: 1
    }, { quoted: msg });

		   

  break;
}

case 'downloadmenu': {
    const caption = `
╭─〔 *📥 DOWNLOAD MENU* 〕─╮
🎬 .fb <url> — Facebook Downloader  
🎶 .song <name> — Song Download  
🎞 .tiktok <url> — TikTok Downloader  
🎥 .ig <url> — Instagram Reel  
🎧 .ytmp3 <url> — YouTube to MP3  
📹 .ytmp4 <url> — YouTube to MP4  
╰────────────────────╯
`;
    const buttons = [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '♟️ BACK TO MAIN MENU' }, type: 1 }
    ];

    await socket.sendMessage(m.chat, {
        image: { url: "https://files.catbox.moe/0mwzza.jpg" }, // 📥 Download menu image
        caption,
        footer: '*📥 Download Anything — KAVIDU MD MINI BOT 🔰*',
        buttons,
        headerType: 4
    }, { quoted: msg });
    break;
}


// 🎮 FUN MENU
case 'funmenu': {
    const caption = `
╭─〔 *🎮 FUN MENU* 〕─╮
🤣 .joke — Random Jokes  
🎭 .meme — Funny Meme  
🎲 .quote — Random Quote  
🎨 .anime — Random Anime Pic  
🐱 .cat — Random Cat Pic  
🐶 .dog — Random Dog Pic  
╰────────────────────╯
`;
    const buttons = [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '♟️ BACK TO MAIN MENU' }, type: 1 }
    ];

    await socket.sendMessage(m.chat, {
        image: { url: "https://files.catbox.moe/0mwzza.jpg" }, // 🎮 Fun menu image
        caption,
        footer: '*🎮 Fun Commands — KAVIDU MD MINI BOT 🔰*',
        buttons,
        headerType: 4
    }, { quoted: msg });
    break;
}


// 👥 GROUP MENU
case 'groupmenu': {
    const caption = `
╭─〔 *👥 GROUP MENU* 〕─╮
🔰 .tagall — Tag All  
🚫 .kick <@user> — Remove  
➕ .add <number> — Add  
🛡 .promote <@user> — Make Admin  
⚙️ .demote <@user> — Remove Admin  
🔒 .close — Close Group  
🔓 .open — Open Group  
╰────────────────────╯
`;
    const buttons = [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '♟️ BACK TO MAIN MENU' }, type: 1 },
	];

    await socket.sendMessage(m.chat, {
        image: { url: "https://files.catbox.moe/0mwzza.jpg" }, // 👥 Group menu image
        caption,
        footer: '*👥 Group Management — KAVIDU MD MINI BOT 🔰*',
        buttons,
        headerType: 4
    }, { quoted: msg });
    break;
}


// 👑 OWNER MENU
case 'ownermenu': {
    const caption = `
╭─〔 *👑 OWNER MENU* 〕─╮
🧩 .block <@user> — Block  
💬 .unblock <@user> — Unblock  
🚀 .restart — Restart Bot  
📁 .update — Update Bot  
🧠 .eval <code> — Run Code  
📢 .broadcast — Message All  
🔒 .mode — Public/Private  
╰────────────────────╯
`;
    const buttons = [
        { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '♟️ BACK TO MAIN MENU' }, type: 1 },
    ];

    await socket.sendMessage(m.chat, {
        image: { url: "https://files.catbox.moe/0mwzza.jpg" }, // 👑 Owner menu image
        caption,
        footer: '*👑 Owner Controls — KAVIDU MD MINI BOT 🔰*',
        buttons,
        headerType: 4
    }, { quoted: msg });
    break;
		}
					
				case 'chr': {
    const q = args.join(" ");

    if (!q.includes(",")) {
        return await socket.sendMessage(sender, {
            text: '😒 Please provide the link and emoji separated by a comma.\n\nExample:\n.cnr https://whatsapp.com/channel/120363396379901844/ABCDEF1234,🔥'
        });
    }

    try {
        let [link, emoji] = q.split(",");
        const parts = link.trim().split("/");
        const channelJid = `${parts[4]}@newsletter`;
        const msgId = parts[5];

        await socket.sendMessage(channelJid, {
            react: {
                text: emoji.trim(),
                key: {
                    remoteJid: channelJid,
                    id: msgId,
                    fromMe: false
                },
            },
        });

        await socket.sendMessage(sender, {
            text: `✅ Reacted to the channel message with ${emoji.trim()}`
        });
    } catch (e) {
        console.error("❌ Error in .cnr:", e);
        await socket.sendMessage(sender, {
            text: `❌ Error: ${e.message}`
        });
    }
                     break;
            }
		
                case 'fc': {
                    if (args.length === 0) {
                        return await socket.sendMessage(sender, {
                            text: '😒  Please provide a channel JID.\n\nExample:\n.fcn 120363419102725912@newsletter'
                        });
                    }

                    const jid = args[0];
                    if (!jid.endsWith("@newsletter")) {
                        return await socket.sendMessage(sender, {
                            text: '😒 Invalid JID. Please provide a JID ending with `@newsletter`'
                        });
                    }

                    try {
                        const metadata = await socket.newsletterMetadata("jid", jid);
                        if (metadata?.viewer_metadata === null) {
                            await socket.newsletterFollow(jid);
                            await socket.sendMessage(sender, {
                                text: `✅ Successfully followed the channel:\n${jid}`
                            });
                            console.log(`FOLLOWED CHANNEL: ${jid}`);
                        } else {
                            await socket.sendMessage(sender, {
                                text: `🔰 Already following the channel:\n${jid}`
                            });
                        }
                    } catch (e) {
                        console.error('❌ Error in follow channel:', e.message);
                        await socket.sendMessage(sender, {
                            text: `❌ Error: ${e.message}`
                        });
                    }
                    

			
    
		
	break;
					
case 'ping': {
    var inital = new Date().getTime();
    let ping = await socket.sendMessage(sender, { text: '*_Pinging to Module..._* ❗' }, { quoted: adhimini });
    var final = new Date().getTime();

    return await socket.sendMessage(sender, { text: '❗ *Pong ' + (final - inital) + ' Ms*' }, { edit: ping.key, quoted: adhimini });
                }
                case 'owner': {
                    await socket.sendMessage(sender, { 
                        react: { 
                            text: "👤",
                            key: msg.key 
                        } 
                    });
                    
                    const ownerContact = {
                        contacts: {
                            displayName: 'My Contacts',
                            contacts: [
                                {
                                    vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN;CHARSET=UTF-8:ꜱᴀᴄʜɪ 😚🤍\nTEL;TYPE=Owner,VOICE:+94761332610\nEND:VCARD',
                                },
                                {
                                vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN;CHARSET=UTF-8:ꜱʙᴏɴᴜ 💚🥷\nTEL;TYPE=Coder,VOICE:+94778619890\nEND:VCARD',   
                                },                        
                            ],
                        },
                    };

                    const ownerLocation = {
                        location: {
                            degreesLatitude: 6.9271,
                            degreesLongitude: 80.5550,
                            name: 'Sachithra  Address',
                            address: 'Kegalle , Sri Lanka',
                        },
                    };

                    await socket.sendMessage(sender, ownerContact);
                    await socket.sendMessage(sender, ownerLocation);

    break;
	}
			    

case 'aiimage': {
  const axios = require('axios');

  const q =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption || '';

  const prompt = q.trim();

  if (!prompt) {
    return await socket.sendMessage(sender, {
      text: '🔰 *Please provide a prompt to generate an AI image.*'
    });
  }

  try {
    // Notify that image is being generated
    await socket.sendMessage(sender, {
      text: '🔰 *𝘊𝘙𝘌𝘈𝘛𝘐𝘕𝘎 𝘈𝘐 𝘐𝘔𝘈𝘎𝘌 𝘉𝘠 𝘒𝘈𝘝𝘐𝘋𝘜 𝘔𝘋 𝘔𝘐𝘕𝘐 💣*',
    });

    // Build API URL
    const apiUrl = `https://api.siputzx.my.id/api/ai/flux?prompt=${encodeURIComponent(prompt)}`;

    // Call the AI API
    const response = await axios.get(apiUrl, { responseType: 'arraybuffer' });

    // Validate API response
    if (!response || !response.data) {
      return await socket.sendMessage(sender, {
        text: '❌ *API did not return a valid image. Please try again later.*'
      });
    }

    // Convert the binary image to buffer
    const imageBuffer = Buffer.from(response.data, 'binary');

    // Send the image
    await socket.sendMessage(sender, {
      image: imageBuffer,
      caption: `🔰 ᴋᴀᴠɪᴅᴜ ᴍᴅ ᴍɪɴɪ ᴀɪ ɪᴍᴀɢᴇ \n\n❤️ ᴘʀᴏᴍᴘᴛ ➟ ${prompt}`
    }, { quoted: msg });

  } catch (err) {
    console.error('AI Image Error:', err);

    await socket.sendMessage(sender, {
      text: `❗ *An error occurred:* ${err.response?.data?.message || err.message || 'Unknown error'}`
    });
  }

      
break;
}

case 'gossip':
    try {
        
        const response = await fetch('https://suhas-bro-api.vercel.app/news/gossiplankanews');
        if (!response.ok) {
            throw new Error('ᴀᴘɪ ᴇʀʀᴏʀ 🥺');
        }
        const data = await response.json();


        if (!data.status || !data.result || !data.result.title || !data.result.desc || !data.result.link) {
            throw new Error('API එකෙන් ලැබුණු news data වල ගැටලුවක්');
        }


        const { title, desc, date, link } = data.result;


        let thumbnailUrl = 'https://via.placeholder.com/150';
        try {
            
            const pageResponse = await fetch(link);
            if (pageResponse.ok) {
                const pageHtml = await pageResponse.text();
                const $ = cheerio.load(pageHtml);
                const ogImage = $('meta[property="og:image"]').attr('content');
                if (ogImage) {
                    thumbnailUrl = ogImage; 
                } else {
                    console.warn(`No og:image found for ${link}`);
                }
            } else {
                console.warn(`Failed to fetch page ${link}: ${pageResponse.status}`);
            }
        } catch (err) {
            console.warn(`Thumbnail scrape කරන්න බැරි වුණා from ${link}: ${err.message}`);
        }


        await socket.sendMessage(sender, {
            image: { url: thumbnailUrl },
            caption: formatMessage(
                '𝘒𝘈𝘝𝘐𝘋𝘜 𝘔𝘋 𝘔𝘐𝘕𝘐 𝘎𝘖𝘚𝘐𝘗 𝘕𝘌𝘞𝘚 ♨️',
                `💚➟  *${title}*\n\n${desc}\n\n💚➟ *𝘋𝘈𝘛𝘌* ➟ ${date || 'තවම ලබාදීලා නැත'}\n💚➟  *𝘓𝘐𝘕𝘓* ➟ ${link}`,
                '𝘒𝘈𝘝𝘐𝘋𝘜-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- 💣🔥💥'
            )
        });
    } catch (error) {
        console.error(`Error in 'news' case: ${error.message}`);
        await socket.sendMessage(sender, {
            text: '⚠️ නිව්ස් ගන්න බැරි වුණා සුද්දෝ! 😩 යමක් වැරදුණා වගේ.'
        });
    }
					
    break;

               case 'nasa':
    try {
      
        const response = await fetch('https://api.nasa.gov/planetary/apod?api_key=8vhAFhlLCDlRLzt5P1iLu2OOMkxtmScpO5VmZEjZ');
        if (!response.ok) {
            throw new Error('Failed to fetch APOD from NASA API');
        }
        const data = await response.json();

     
        if (!data.title || !data.explanation || !data.date || !data.url || data.media_type !== 'image') {
            throw new Error('Invalid APOD data received or media type is not an image');
        }

        const { title, explanation, date, url, copyright } = data;
        const thumbnailUrl = url || 'https://via.placeholder.com/150'; // Use APOD image URL or fallback

     
        await socket.sendMessage(sender, {
            image: { url: thumbnailUrl },
            caption: formatMessage(
                '𝘒𝘈𝘝𝘐𝘋𝘜 𝘔𝘋 𝘔𝘐𝘕𝘐 𝘕𝘈𝘚𝘈 𝘕𝘌𝘞𝘚 ♨️',
                `♻️  *${title}*\n\n${explanation.substring(0, 200)}...\n\n♻️ *𝘋𝘈𝘛𝘌* ➟ ${date}\n${copyright ? ` *🫟𝘊𝘙𝘌𝘋𝘐𝘛𝘌*  ➟ ${copyright}` : ''}\n*🫟𝘓𝘐𝘕𝘒 ➟*: https://apod.nasa.gov/apod/astropix.html`,
                '𝘒𝘈𝘝𝘐𝘋𝘜-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- ☠️🔥'
            )
        });

    } catch (error) {
        console.error(`Error in 'apod' case: ${error.message}`);
        await socket.sendMessage(sender, {
            text: '*😒 ඕවා බලන්න ඕනි නැ ගිහින් නිදාගන්න*'
        });
    }
    break;
                case 'cricket':
                    try {
                        console.log('Fetching cricket news from API...');
                        const response = await fetch('https://suhas-bro-api.vercel.app/news/cricbuzz');
                        console.log(`API Response Status: ${response.status}`);

                        if (!response.ok) {
                            throw new Error(`API request failed with status ${response.status}`);
                        }

                        const data = await response.json();
                        console.log('API Response Data:', JSON.stringify(data, null, 2));

                        if (!data.status || !data.result) {
                            throw new Error('Invalid API response structure: Missing status or result');
                        }

                        const { title, score, to_win, crr, link } = data.result;
                        if (!title || !score || !to_win || !crr || !link) {
                            throw new Error('Missing required fields in API response: ' + JSON.stringify(data.result));
                        }

                        console.log('Sending message to user...');
                        await socket.sendMessage(sender, {
                            text: formatMessage(
                                '*𝘒𝘈𝘝𝘐𝘋𝘜 𝘔𝘋 𝘊𝘙𝘐𝘊𝘒𝘌𝘛 𝘕𝘌𝘞𝘚 🏆',
                                `♦ *${title}*\n\n` +
                                `♦ *𝘔𝘈𝘙𝘒*: ${score}\n` +
                                `♦ *𝘛𝘖 𝘞𝘐𝘕*: ${to_win}\n` +
                                `♦ *𝘙𝘈𝘛𝘌*: ${crr}\n\n` +
                                `♦ *𝘓𝘐𝘕𝘒*: ${link}`,
								
                                '𝘒𝘈𝘝𝘐𝘋𝘜-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- 🤍🔥'
                            )
                        });
                        console.log('Message sent successfully.');
                    } catch (error) {
                        console.error(`Error in 'cricket' case: ${error.message}`);
                        await socket.sendMessage(sender, {
                            text: '*😒😒 හා හා Cricket ඕනේ නෑ ගිහින් වෙන මොකක් හරි බලන්න.*'
                        });
                    }
                    break;
  
					case 'tt': {
    const axios = require('axios');

    const q = msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption || '';

    const link = q.replace(/^[.\/!]tiktok(dl)?|tt(dl)?\s*/i, '').trim();

    if (!link) {
        return await socket.sendMessage(sender, {
            text: '*ᴜꜱᴀɢᴇ ➟ * .ᴛᴛ <link> 👨‍🔧'
        }, { quoted: msg });
    }

    if (!link.includes('tiktok.com')) {
        return await socket.sendMessage(sender, {
            text: '❌ *Invalid TikTok link.*'
        }, { quoted: msg });
    }

    try {
        await socket.sendMessage(sender, {
            text: '[ KAVIDU MD AUTOMATICALLY TIK TOK DOWNLODER ] ❤️'
        }, { quoted: msg });

        const apiUrl = `https://delirius-apiofc.vercel.app/download/tiktok?url=${encodeURIComponent(link)}`;
        const { data } = await axios.get(apiUrl);

        if (!data?.status || !data?.data) {
            return await socket.sendMessage(sender, {
                text: '❌ Failed to fetch TikTok video.'
            }, { quoted: msg });
        }

        const { title, like, comment, share, author, meta } = data.data;
        const video = meta.media.find(v => v.type === "video");

        if (!video || !video.org) {
            return await socket.sendMessage(sender, {
                text: '❌ No downloadable video found.'
            }, { quoted: msg });
        }

        const caption = `📥 *𝘠𝘖𝘜 𝘙𝘌𝘘𝘜𝘌𝘚𝘛 𝘛𝘐𝘒 𝘛𝘖𝘒 𝘝𝘐𝘋𝘌𝘖 *\n\n` +
                        `👤 *𝘜𝘚𝘌𝘙 ➟* ${author.nickname} (@${author.username})\n` +
                        `📂 *𝘛𝘐𝘛𝘛𝘓𝘌 ➟* ${title}\n` +
                        `❤️ *𝘓𝘐𝘒𝘌𝘚* ➟ ${like}\n📋*𝘊𝘖𝘔𝘔𝘌𝘕𝘛𝘚 ➟* ${comment}\n🔀 *𝘚𝘏𝘌𝘙𝘙𝘚 ➟* ${share}\nBLOOD-𝘟-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- ❤️🔥`;

        await socket.sendMessage(sender, {
            video: { url: video.org },
            caption: caption,
            contextInfo: { mentionedJid: [msg.key.participant || sender] }
        }, { quoted: msg });

    } catch (err) {
        console.error("TikTok command error:", err);
        await socket.sendMessage(sender, {
            text: `❌ An error occurred:\n${err.message}`
        }, { quoted: msg });
    }

    break;
									  }
case 'jid': {
    const q = body.trim().split(" ")[1]?.toLowerCase(); 
    try {
        const chatJid = m.key?.remoteJid || "Unknown";
        const senderJid = m.sender || "Unknown";
        const participantJid = m.key?.participant || "Not applicable";
        const quoted = m.quoted || null;

        // Detect type
        let type = "Unknown";
        if (chatJid.endsWith("@g.us")) type = "Group";
        else if (chatJid.endsWith("@broadcast")) type = "Broadcast";
        else if (chatJid.endsWith("@s.whatsapp.net")) type = "Private Chat";
        else if (chatJid.endsWith("@channel") || chatJid.endsWith("@newsletter")) type = "Channel";

        // Case handling
        switch (q) {
            case "me":
                await socket.sendMessage(sender, {
                    text: `👨‍🔧 *𝘽𝙊𝙏 𝙅𝙄𝘿 ➟ * ${socket.user?.id || "Unknown"}`
                });
                break;

            case "reply":
            case "quoted":
                if (!quoted) {
                    return await socket.sendMessage(sender, {
                        text: "❌ No quoted message found!"
                    });
                }

                return await socket.sendMessage(sender, {
                    text:
                        `📋 *𝙈𝙎𝙂 𝙄𝙉𝙁𝙊 ➟ *\n\n` +
                        `👤 *𝙎𝙀𝙉𝘿𝙀𝙍 ➟* ${quoted.sender || "Unknown"}\n` +
                        `👥 *𝙋𝙍𝘼𝘾𝙏𝙄𝙈𝙀𝙉𝙏 ➟* ${quoted.participant || "N/A"}\n` +
                        `💭 *𝘾𝙃𝘼𝙏 ➟* ${quoted.chat || chatJid}`
					    `*𝘒𝘈𝘝𝘐𝘋𝘜-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- 🔥*`
                });

            default:
                await socket.sendMessage(sender, {
                    text:
                        `📋 *𝙅𝙄𝘿 𝙄𝙉𝙁𝙊 ➟*\n\n` +
                        `📂 *𝘾𝙃𝘼𝙏 𝙏𝙔𝙋𝙀 ➟* ${type}\n\n` +
                        `⛓️ *𝘾𝙃𝘼𝙏 𝙅𝙄𝘿 ➟* ${chatJid}\n` +
                        `💥 *𝙎𝙀𝙉𝘿𝘼𝙍 𝙅𝙄𝘿 ➟* ${senderJid}\n` +
                        `❤️ *𝙋𝙍𝘼𝘾𝙄𝘾𝙎 𝙄𝘿 ➟* ${participantJid}`
                });
        }
    } catch (err) {
        console.log("JID Error:", err);
        await socket.sendMessage(sender, {
            text: `❌ Error: ${err.message || err.toString()}`
        });
    }
    break;
}
				case 'voice': {
    const yts = require('yt-search');
    const ddownr = require('denethdev-ytmp3');

    // ✅ Extract YouTube ID from different types of URLs
    function extractYouTubeId(url) {
        const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
        const match = url.match(regex);
        return match ? match[1] : null;
    }

    // ✅ Convert YouTube shortened/invalid links to proper watch URL
    function convertYouTubeLink(input) {
        const videoId = extractYouTubeId(input);
        if (videoId) {
            return `https://www.youtube.com/watch?v=${videoId}`;
        }
        return input; // If not a URL, assume it's a search query
    }

    // ✅ Get message text or quoted text
    const q = msg.message?.conversation || 
              msg.message?.extendedTextMessage?.text || 
              msg.message?.imageMessage?.caption || 
              msg.message?.videoMessage?.caption || 
              '';

    if (!q || q.trim() === '') {
        return await socket.sendMessage(sender, { text: '*`Need YT_URL or Title`*' });
    }

    const fixedQuery = convertYouTubeLink(q.trim());

    try {
        const search = await yts(fixedQuery);
        const data = search.videos[0];
        if (!data) {
            return await socket.sendMessage(sender, { text: '*`No results found`*' });
        }

        const url = data.url;
        const desc = `
 [ *𝘒𝘈𝘝𝘐𝘋𝘜 𝘔𝘋 𝘔𝘐𝘕𝘐 𝘝𝘖𝘐𝘊𝘌 𝘛𝘗𝘗 💫* ]

📋 *ᴛɪᴛᴛʟᴇ ➟* ${data.title} ☠️

⌛ *ᴅᴜʀᴀᴛɪᴏɴ ➟* ${data.timestamp} ☠️

📤 *ᴜᴘʟᴏᴛᴇᴅ ➟:* ${data.ago} ☠️

> 𝘒𝘈𝘝𝘐𝘋𝘜-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- 🔰
`;

        await socket.sendMessage(sender, {
            image: { url: data.thumbnail },
            caption: desc,
            contextInfo: {
                mentionedJid: [],
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363400387858467@newsletter',
                    newsletterName: "𝘒𝘈𝘝𝘐𝘋𝘜-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- 💚🔥",
                    serverMessageId: 999
                }
            }
        }, { quoted: msg });

        await socket.sendMessage(sender, { react: { text: '❤️', key: msg.key } });

        const result = await ddownr.download(url, 'mp3');
        const downloadLink = result.downloadUrl;

        await socket.sendMessage(sender, { react: { text: '💚', key: msg.key } });

        await socket.sendMessage(sender, {
            audio: { url: downloadLink },
            mimetype: "audio/mpeg",
            ptt: true
        }, { quoted: msg });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: "*`Error occurred while downloading`*" });
				}
				   break;
				}

    
	case 'system': {
    // Calculate bot uptime
    const startTime = socketCreationTime.get(number) || Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = Math.floor(uptime % 60);

    // Menu caption
    const menuCaption = `
> 𝙒𝙀𝙇𝙇𝘾𝙊𝙈𝙀 𝙆𝘼𝙑𝙄𝘿𝙐 𝙈𝘿 𝙫1 ☚

*╭────◅●◆●▻────➣*
*│┌──────➣*
*││ 𝕓𝕠𝕥 𝕦𝕡 𝕥𝕚𝕞𝕖 ➟ ${hours}h ${minutes}m ${seconds}s*
*││ 𝕓𝕠𝕥𝕒𝕔𝕥𝕚𝕧𝕖 𝕔𝕠𝕦𝕟𝕥𝕖 ➟ ${activeSockets.size}*
*││ 𝕞𝕚𝕟𝕚 𝕧𝕖𝕣𝕤𝕚𝕠𝕟 ➟ 1.0.0 ᴠ*
*││ 𝕕𝕖𝕡𝕝𝕠𝕪 𝕡𝕝𝕒𝕥𝕗𝕣𝕠𝕞 ➟ Heroku ❲ ꜰʀᴇᴇ ❳*
*││ 𝕞𝕚𝕟𝕚 𝕓𝕠𝕥 𝕠𝕨𝕟𝕖𝕣 ➟ 94767054052*
*│└──────➣*
*╰────◅●◆●▻────➢*

🔰 𝙆𝘼𝙑𝙄𝘿𝙐 𝗠𝗗 – 𝗔 𝗡𝗲𝘄 𝗘𝗿𝗮 𝗼𝗳 𝗪𝗵𝗮𝘁𝘀𝗔𝗽𝗽 𝗕𝗼𝘁 🔰

> 𝙊𝙬𝙣𝙚𝙧 𝙗𝙮 𝙠𝙖𝙫𝙞𝙙𝙪 𝙞𝙣𝙙𝙪𝙬𝙖𝙧𝙖

➤ 𝐀𝐕𝐀𝐈𝐋𝐀𝐁𝐋𝐄 𝐂𝐎𝐌𝐌𝐀𝐍𝐃

> © 𝙆𝘼𝙑𝙄𝘿𝙐 𝙈𝘿 𝙈𝙄𝙉𝙄 𝘽𝙊𝙏 𝙑1`;

    
    const verifiedContact = {
        key: {
            fromMe: false,
            participant: `0@s.whatsapp.net`,
            remoteJid: "status@broadcast"
        },
        message: {
            contactMessage: {
                displayName: "KAVIDU INDUWARA ✅",
                vcard: "BEGIN:VCARD\nVERSION:3.0\nFN: KAVIDU MD VERIFIED ✅\nORG:CASEYRHODES-TECH BOT;\nTEL;type=CELL;type=VOICE;waid=94767054052:+94767054052\nEND:VCARD"
            }
        }
    };

    
    const contextInfo = {
        mentionedJid: [m.sender],
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
            newsletterJid: '120363400387858467@newsletter',
            newsletterName: 'KAVIDU-MD MINI V1 🔰',
            serverMessageId: 143
        }
    };

    // Template buttons
    const templateButtons = [
        {
            buttonId: `${config.PREFIX}alive`,
            buttonText: { displayText: '❲ ALIVE ☠️ ❳ ' },
            type: 1,
        },
        {
            buttonId: `${config.PREFIX}owner`,
            buttonText: { displayText: '❲ OWNER 👑❳' },
            type: 1,
        },
        {
            buttonId: `${config.PREFIX}mainmenu`,
            buttonText: { displayText: '❲ MAIN MENU 📜 ❳' },
            type: 1,
        }
    ];

    // Send menu image + caption + buttons
    const sentMsg = await conn.sendMessage(
        from, 
        { 
            image: { url: "https://files.catbox.moe/0mwzza.jpg" }, 
            caption: menuCaption,
            buttons: templateButtons,
            headerType: 1,
            contextInfo: contextInfo
        }, 
        { quoted: verifiedContact }
    );

    break;
		}	   

  
			
case 'owner': {
    const ownerNumber = '+94767054052';
    const ownerName = '𝒦𝒜𝒱𝐼𝒟𝒰 𝐼𝒩𝒟𝒰𝒲𝒜𝑅𝒜';
    const organization = '*𝙆𝘼𝙑𝙄𝘿𝙐 𝙈𝘿 𝘽𝙊𝙏 & 𝙊𝙒𝙉𝙀𝙍  👨‍🔧🔥*';

    const vcard = 'BEGIN:VCARD\n' +
                  'VERSION:3.0\n' +
                  `FN:${ownerName}\n` +
                  `ORG:${organization};\n` +
                  `TEL;type=CELL;type=VOICE;waid=${ownerNumber.replace('+', '')}:${ownerNumber}\n` +
                  'END:VCARD';

    try {
        // Send vCard contact
        const sent = await socket.sendMessage(from, {
            contacts: {
                displayName: ownerName,
                contacts: [{ vcard }]
            }
        });

        // Then send message with reference
        await socket.sendMessage(from, {
            text: `*KAVIDU MD MINI BOT OWNER 👑*\n\n👨‍🔧 Name: ${ownerName}\n💭 ηυмвєя ➥ ${ownerNumber}\n\n> 𝘒𝘈𝘝𝘐𝘋𝘜-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- 🔥`,
            contextInfo: {
                mentionedJid: [`${ownerNumber.replace('+', '')}@s.whatsapp.net`],
                quotedMessageId: sent.key.id
            }
        }, { quoted: msg });

    } catch (err) {
        console.error('❌ Owner command error:', err.message);
        await socket.sendMessage(from, {
            text: '❌ Error sending owner contact.'
        }, { quoted: msg });
    }
				
          
        
  break;
}
			    
  // *** Main spotify command ***

case 'spotify': {
  const axios = require('axios');
  const RHT = `❎ *Please provide a valid Spotify URL or search term.*\n\n📌 *Example:* \`.spotify Shape of You\``;

  if (!args[0]) {
    return await socket.sendMessage(from, {
      text: RHT
    }, { quoted: msg });
  }

  const q = args.join(" ");

  try {
    const res = await axios.get(`https://delirius-apiofc.vercel.app/search/spotify?q=${encodeURIComponent(q)}&limit=5`);

    if (!res.data || !res.data.data || res.data.data.length === 0) {
      return await socket.sendMessage(from, {
        text: '❌ *No results found for that query.*'
      }, { quoted: msg });
    }

    // Prepare selection rows
    const rows = res.data.data.map(item => ({
      title: item.title || 'No Title',
      description: `Album: ${item.album || 'Unknown'}`,
      id: `${config.PREFIX}spotifydown ${item.url}` // THIS ID triggers the subcommand
    }));

    const sections = [
      {
        title: '🎵 Spotify Search Results',
        rows: rows
      }
    ];

    const templateButtons = [
      {
        buttonId: `${config.PREFIX}alive`,
        buttonText: { displayText: '❲ ALIVE 🏮 ❳' },
        type: 1,
      },
      {
        buttonId: `${config.PREFIX}owner`,
        buttonText: { displayText: '❲ OWNER 👑❳' },
        type: 1,
      },
      {
        buttonId: 'action',
        buttonText: { displayText: '❲ ᴍᴇɴᴜ ᴏᴘᴛɪᴏɴ 📜 ❳' },
        type: 4,
        nativeFlowInfo: {
          name: 'single_select',
          paramsJson: JSON.stringify({
            title: 'Choose a song to download 🎶',
            sections: sections
          })
        }
      }
    ];

    await socket.sendMessage(from, {
      text: `🎵 ꜱᴇᴀʀᴄʜ ᴠɪᴅᴇᴏ ɪɴ ʀᴇꜱᴜʟᴛ 🔰*${q}*. Select a song below:`,
      footer: '𝘒𝘈𝘝𝘐𝘋𝘜-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- 🔥',
      buttons: templateButtons,
      headerType: 1
    }, { quoted: msg });

  } catch (e) {
    console.error('Spotify search error:', e);
    return await socket.sendMessage(from, {
      text: '❌ *Error occurred while searching Spotify. Try again later.*'
    }, { quoted: msg });
  }

  break;
	      }
// *** spotifydown subcommand: show song info + buttons ***
case 'spotifydown': {
  const axios = require('axios');
  if (!args[0]) {
    return await socket.sendMessage(from, {
      text: '❎ *Please provide a valid Spotify song URL.*'
    }, { quoted: msg });
  }

  const url = args[0];
  try {
    const res = await axios.get(`https://delirius-apiofc.vercel.app/download/spotifydl?url=${encodeURIComponent(url)}`);
    const song = res.data.data;

    if (!song) {
      return await socket.sendMessage(from, {
        text: '❌ *Could not retrieve song info.*'
      }, { quoted: msg });
    }

    const caption = `
    [ 💫ＫＡＶＩＤＵ ＭＤ-ＭＩＮＩ-ＢＯＴ-ＳＰＯＴＩＦＹ-ＤＬ 💫 ]
📋 *𝘛𝘐𝘛𝘛𝘌𝘓 ➟* ${song.title}
👤 *𝘈𝘜𝘛𝘏𝘖𝘙 ➟*  ${song.author}
📂 *𝘈𝘓𝘉𝘜𝘔 ➟* ${song.album}
⌛ *𝘛𝘐𝘔𝘌 ➟* ${song.duration}
📎 *𝘚𝘖𝘕𝘎 𝘓𝘐𝘕𝘒 ➟* ${url}

𝘒𝘈𝘝𝘐𝘋𝘜-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- 💚🔥`;

    const templateButtons = [
      {
        buttonId: `${config.PREFIX}spaaudio ${song.url}`,
        buttonText: { displayText: 'ꜱᴏɴɢ ᴀᴜᴅɪᴏ 🎶' },
        type: 1,
      },
      {
        buttonId: `${config.PREFIX}spadoc ${song.url}&${song.image}&${song.title}`,
        buttonText: { displayText: 'ꜱᴏɴɢ ᴅᴏᴄᴜᴍᴇɴᴛ 📙' },
        type: 1,
      },
      {
        buttonId: `${config.PREFIX}spavoice ${song.url}`,
        buttonText: { displayText: 'ꜱᴏɴɢ ᴠᴏɪᴄᴇ ᴛᴘᴘ 🎤' },
        type: 1,
      },
    ];

    await socket.sendMessage(from, {
      image: { url: song.image },
      caption,
      foote𝘳: '𝙿𝙾𝚆𝙴𝚁𝙳 𝙱𝚈 𝙺𝙰𝚅𝙸𝙳𝚄 𝙼𝙳 𝙼𝙸𝙽𝙸 𝙱𝙾𝚃 ☠️🔥',
      buttons: templateButtons,
      headerType: 1,
    }, { quoted: msg });

  } catch (e) {
    console.error('Spotify info error:', e);
    return await socket.sendMessage(from, {
      text: '❌ *Error occurred while fetching song info.*'
    }, { quoted: msg });
  }
  break;
}

// *** spaaudio subcommand ***
case 'spaaudio': {
  if (!args[0]) {
    return await socket.sendMessage(from, {
      text: '❎ *Please provide a valid audio URL to download.*'
    }, { quoted: msg });
  }

  try {
    await socket.sendMessage(from, { react: { text: '⬆️', key: msg.key } });

    await socket.sendMessage(from, {
      audio: { url: args[0] },
      mimetype: 'audio/mpeg',
      contextInfo: { mentionedJid: [sender] }
    }, { quoted: msg });

    await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });
  } catch (e) {
    console.error('spaaudio error:', e);
    return await socket.sendMessage(from, {
      text: '❌ *Failed to send audio.*'
    }, { quoted: msg });
  }
  break;
}

// *** spadoc subcommand ***
case 'spadoc': {
  if (!args[0]) {
    return await socket.sendMessage(from, {
      text: '❎ *Please provide a valid document URL & metadata.*\n\nUsage: .spadoc <url>&<image>&<title>'
    }, { quoted: msg });
  }

  try {
    // args[0] = url&image&title
    const [url, image, title] = args.join(" ").split("&");

    await socket.sendMessage(from, { react: { text: '⬆️', key: msg.key } });

    await socket.sendMessage(from, {
      document: { url: url },
      mimetype: 'audio/mpeg',
      fileName: `${title}.mp3`,
      caption: `*ꜱᴏɴɢ ᴛɪᴛᴛᴇʟ ➟ * ${title}\n 𝘒𝘈𝘝𝘐𝘋𝘜-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- 💚🔥`,
      contextInfo: {
        externalAdReply: {
          title: 'Spotify Downloader',
          body: title,
          mediaType: 1,
          sourceUrl: url,
          thumbnailUrl: image,
          renderLargerThumbnail: true,
          showAdAttribution: true
        }
      }
    }, { quoted: msg });

    await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });
  } catch (e) {
    console.error('spadoc error:', e);
    return await socket.sendMessage(from, {
      text: '❌ *Failed to send document.*'
    }, { quoted: msg });
  }
  break;
}

// *** spavoice subcommand ***
case 'spavoice': {
  if (!args[0]) {
    return await socket.sendMessage(from, {
      text: '❎ *Please provide a valid voice URL to download.*'
    }, { quoted: msg });
  }

  try {
    await socket.sendMessage(from, { react: { text: '⬆️', key: msg.key } });

    await socket.sendMessage(from, {
      audio: { url: args[0] },
      mimetype: 'audio/mpeg',
      ptt: true,
      contextInfo: { mentionedJid: [sender] }
    }, { quoted: msg });

    await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });
  } catch (e) {
    console.error('spavoice error:', e);
    return await socket.sendMessage(from, {
      text: '❌ *Failed to send voice message.*'
    }, { quoted: msg });
  }
  
               
  break;
       }
			    
case 'fancy': {
  const axios = require("axios");

  const q =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption || '';

  const text = q.trim().replace(/^.fancy\s+/i, ""); // remove .fancy prefix

  if (!text) {
    return await socket.sendMessage(sender, {
      text: "❎ *Please provide text to convert into fancy fonts.*\n\n📌 *Example:* `.fancy Sula`"
    });
  }

  try {
    const apiUrl = `https://www.dark-yasiya-api.site/other/font?text=${encodeURIComponent(text)}`;
    const response = await axios.get(apiUrl);

    if (!response.data.status || !response.data.result) {
      return await socket.sendMessage(sender, {
        text: "❌ *Error fetching fonts from API. Please try again later.*"
      });
    }

    // Format fonts list
    const fontList = response.data.result
      .map(font => `*${font.name}:*\n${font.result}`)
      .join("\n\n");

    const finalMessage = `Fancy Fonts Converter\n\n${fontList}\n\n_𝘉𝘓𝘖𝘖𝘋-𝘟-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- 🤍🔥_`;

    await socket.sendMessage(sender, {
      text: finalMessage
    }, { quoted: msg });

  } catch (err) {
    console.error("Fancy Font Error:", err);
    await socket.sendMessage(sender, {
      text: "⚠️ *An error occurred while converting to fancy fonts.*"
    });
  }

  break;
	}
case 'song': {
  const { ytsearch } = require('@dark-yasiya/yt-dl.js');
  const RPL = `💭😒 *Please provide a song name or YouTube link to search.*\n\n👨‍🔧 *Example:* \`.song Shape of You\``;

  if (!args[0]) {
    return await socket.sendMessage(from, { text: RPL }, { quoted: msg });
  }

  const q = args.join(" ");

  try {
    const yt = await ytsearch(q);

    if (!yt || !yt.results || yt.results.length === 0) {
      return reply("❌ *No results found. Try a different song title or link.*");
    }

    const song = yt.results[0];
    const url = song.url;
    const thumb = song.thumbnail;

    // 🔹 Sadiya-tech API download link
    const apiUrl = `https://sadiya-tech-apis.vercel.app/download/ytdl?url=${encodeURIComponent(url)}`;

    const caption = `ᴋᴀᴠɪᴅᴜ ᴍᴅ ᴍɪɴɪ ʙᴏᴛ ꜱᴏɴɢ ᴅᴏᴡɴʟᴏᴀᴅ 🎶

*📋 𝙏𝙄𝙏𝙏𝙇𝙀 ➟* ${song.title}
*💫 𝘿𝙐𝙍𝘼𝙏𝙄𝙊𝙉 ➟* ${song.timestamp}
*👤 𝘾𝙍𝙀𝘼𝙏𝙊𝙍 ➟* ${song.author.name}
*📎 𝙎𝙊𝙉𝙂 𝙐𝙍𝙇 ➟* ${url}
*⬇️ 𝘿𝙊𝙒𝙉𝙇𝙊𝘼𝘿 ➟* ${apiUrl}

> 𝘒𝘈𝘝𝘐𝘋𝘜-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- 💚🔥`;

    const templateButtons = [
      {
        buttonId: `${config.PREFIX}mp3play ${apiUrl}`,
        buttonText: { displayText: 'ꜱᴏɴɢ ᴍᴘ3 🎶' },
        type: 1,
      },
      {
        buttonId: `${config.PREFIX}mp3doc ${apiUrl}`,
        buttonText: { displayText: 'ꜱᴏɴɢ ᴅᴏᴄᴜᴍᴇɴᴛ 📂' },
        type: 1,
      },
      {
        buttonId: `${config.PREFIX}mp3ptt ${apiUrl}`,
        buttonText: { displayText: 'ꜱᴏɴɢ ᴠᴏɪᴄᴇ ᴛᴘᴘ 🎤' },
        type: 1
      }
    ];

    await socket.sendMessage(from, {
      image: { url: thumb },
      caption: caption.trim(),
      footer: '𝘒𝘈𝘝𝘐𝘋𝘜 𝘔𝘋 𝘉𝘠 𝘒𝘈𝘝𝘐𝘋𝘜 𝘐𝘕𝘋𝘜𝘞𝘈𝘙𝘈 ☠️⚡',
      buttons: templateButtons,
      headerType: 1
    }, { quoted: msg });

  } catch (e) {
    console.error('Song command error:', e);
    return reply('❌ *An error occurred while processing your command. Please try again.*\n\n> *𝘒𝘈𝘝𝘐𝘋𝘜-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- 💚🔥*');
  }

  break;
}
   
case 'mp3play': {
	
	const axios = require("axios");
	
    const url = msg.body?.split(" ")[1];
    if (!url || !url.startsWith('http')) {
        return await socket.sendMessage(sender, { text: "*`Invalid or missing URL`*" });
    }

    try {
        const apiUrl = `https://sadiya-tech-apis.vercel.app/download/ytdl?url=${encodeURIComponent(url)}`;
        const { data } = await axios.get(apiUrl);

        if (!data || !data.result?.download_url) {
            return await socket.sendMessage(sender, { text: "*`Failed to fetch MP3 download link`*" });
        }

        await socket.sendMessage(sender, {
            audio: { url: data.result.download_url },
            mimetype: "audio/mpeg"
        }, { quoted: msg });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: "*`Error occurred while downloading MP3`*" });
    }

    break;
}

case 'mp3doc': {
    const url = msg.body?.split(" ")[1];
    if (!url || !url.startsWith('http')) {
        return await socket.sendMessage(sender, { text: "*`Invalid or missing URL`*" });
    }

    try {
        const apiUrl = `https://sadiya-tech-apis.vercel.app/download/ytdl?url=${encodeURIComponent(url)}`;
        const { data } = await axios.get(apiUrl);

        if (!data || !data.result?.download_url) {
            return await socket.sendMessage(sender, { text: "*`Failed to fetch MP3 download link`*" });
        }

        await socket.sendMessage(sender, {
            document: { url: data.result.download_url },
            mimetype: "audio/mpeg",
            fileName: `ᴋᴀᴠɪᴅᴜ ᴍɪɴɪ ʙᴏᴛ ᴍᴘ3ᴅᴏᴄ 🙂‍↔️🎧`
        }, { quoted: msg });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: "*`Error occurred while downloading as document`*" });
    }

    break;
}

case 'mp3ptt': {
    const url = msg.body?.split(" ")[1];
    if (!url || !url.startsWith('http')) {
        return await socket.sendMessage(sender, { text: "*`Invalid or missing URL`*" });
    }

    try {
        const apiUrl = `https://delirius-apiofc.vercel.app/download/ytmp3?url=${encodeURIComponent(url)}`;
        const { data } = await axios.get(apiUrl);

        if (!data || !data.result?.download_url) {
            return await socket.sendMessage(sender, { text: "*`Failed to fetch MP3 download link`*" });
        }

        await socket.sendMessage(sender, {
            audio: { url: data.result.download_url },
            mimetype: "audio/mpeg",
            ptt: true // voice note
        }, { quoted: msg });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(sender, { text: "*`Error occurred while sending as voice note`*" });
    }

    break;
													 } 
			    


//=========
case 'fb': {
  const getFBInfo = require('@xaviabot/fb-downloader');

  const RHT = `❎ *Please provide a valid Facebook video link.*\n\n📌 *Example:* \`.fb https://fb.watch/abcd1234/\``;

  if (!args[0] || !args[0].startsWith('http')) {
    return await socket.sendMessage(from, {
      text: RHT
    }, { quoted: msg });
  }

  try {
    await socket.sendMessage(from, { react: { text: "⏳", key: msg.key } });

    const fb = await getFBInfo(args[0]);
    const url = args[0];
    const caption = ` 💚 *𝘒𝘈𝘝𝘐𝘋𝘜 𝘔𝘋 𝘔𝘐𝘕𝘐 𝘉𝘖𝘛 𝘍𝘉 𝘋𝘖𝘞𝘕𝘓𝘖𝘋𝘌𝘙* ❤️

☠️ *Title:* ${fb.title}
🔰 *URL:* ${url}

> 𝘒𝘈𝘝𝘐𝘋𝘜-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- 💣💥

🔰 *𝗖𝗟𝗜𝗖𝗞 𝗛𝗘𝗔𝗥𝗘*`;

    const templateButtons = [
      {
        buttonId: `.fbsd ${url}`,
        buttonText: { displayText: 'ꜱᴅ ᴠɪᴅᴇᴏ 📽️' },
        type: 1
      },
      {
        buttonId: `.fbhd ${url}`,
        buttonText: { displayText: 'ʜᴅ ᴠɪᴅᴇᴏ 🎥' },
        type: 1
      },
      {
        buttonId: `.fbaudio ${url}`,
        buttonText: { displayText: 'ᴀᴜᴅɪᴏ 🎵' },
        type: 1
      },
      {
        buttonId: `.fbdoc ${url}`,
        buttonText: { displayText: 'ᴀᴜᴅɪᴏ ᴅᴏᴄ 📂' },
        type: 1
      },
      {
        buttonId: `.fbptt ${url}`,
        buttonText: { displayText: 'ᴠᴏɪᴄᴇ ɴᴏᴛᴇ 🎤' },
        type: 1
      }
    ];

    await socket.sendMessage(from, {
      image: { url: fb.thumbnail },
      caption: caption,
      footer: '💣 кανι∂υ м∂ мιηι ƒв ∂σωηℓσ∂єя 💣',
      buttons: templateButtons,
      headerType: 4
    }, { quoted: msg });

  } catch (e) {
    console.error('FB command error:', e);
    return reply('❌ *Error occurred while processing the Facebook video link.*');
  }

  break;
		     }

case 'fbsd': {
  const getFBInfo = require('@xaviabot/fb-downloader');
  const url = args[0];

  if (!url || !url.startsWith('http')) return reply('❌ *Invalid Facebook video URL.*');

  try {
    const res = await getFBInfo(url);
    await socket.sendMessage(from, {
      video: { url: res.sd },
      caption: '💣 уσυ яєqυєѕт ѕ∂ νι∂єσ ву кανι∂υ м∂ мιηι вσт 💣🔥💥'
    }, { quoted: msg });
  } catch (err) {
    console.error(err);
    reply('❌ *Failed to fetch SD video.*');
  }

  break;
}

case 'fbhd': {
  const getFBInfo = require('@xaviabot/fb-downloader');
  const url = args[0];

  if (!url || !url.startsWith('http')) return reply('❌ *Invalid Facebook video URL.*');

  try {
    const res = await getFBInfo(url);
    await socket.sendMessage(from, {
      video: { url: res.hd },
      caption: '💚 уσυ яєqυєѕт н∂ νι∂єσ ву кανι∂υ м∂ мιηι вσт 🧩🔥'
    }, { quoted: msg });
  } catch (err) {
    console.error(err);
    reply('❌ *Failed to fetch HD video.*');
  }

  break;
}

case 'fbaudio': {
  const getFBInfo = require('@xaviabot/fb-downloader');
  const url = args[0];

  if (!url || !url.startsWith('http')) return reply('❌ *Invalid Facebook video URL.*');

  try {
    const res = await getFBInfo(url);
    await socket.sendMessage(from, {
      audio: { url: res.sd },
      mimetype: 'audio/mpeg'
    }, { quoted: msg });
  } catch (err) {
    console.error(err);
    reply('❌ *Failed to extract audio.*');
  }

  break;
}

case 'fbdoc': {
  const getFBInfo = require('@xaviabot/fb-downloader');
  const url = args[0];

  if (!url || !url.startsWith('http')) return reply('❌ *Invalid Facebook video URL.*');

  try {
    const res = await getFBInfo(url);
    await socket.sendMessage(from, {
      document: { url: res.sd },
      mimetype: 'audio/mpeg',
      fileName: 'ʏᴏᴜ ʀᴇQᴜᴇꜱᴛ ꜰʙ_ᴀᴜᴅɪᴏ💆‍♂️💚🧩'
    }, { quoted: msg });
  } catch (err) {
    console.error(err);
    reply('❌ *Failed to send as document.*');
  }

  break;
}

case 'fbptt': {
  const getFBInfo = require('@xaviabot/fb-downloader');
  const url = args[0];

  if (!url || !url.startsWith('http')) return reply('❌ *Invalid Facebook video URL.*');

  try {
    const res = await getFBInfo(url);
    await socket.sendMessage(from, {
      audio: { url: res.sd },
      mimetype: 'audio/mpeg',
      ptt: true
    }, { quoted: msg });
  } catch (err) {
    console.error(err);
    reply('❌ *Failed to send voice note.*');
  }

break;
			}
			    

case 'niko': {
    try {
        const imageUrl = 'https://cdn.nekos.life/neko/neko217.png';
        const captionText = '💣 [ ᴋᴀᴠɪᴅᴜ ᴍɪɴɪ ʙᴏᴛ ɴɪᴋᴏ ᴀɴɪᴍᴇ ɪᴍᴀɢᴇ ]💣';

        await socket.sendMessage(m.chat, {
            image: { url: imageUrl },
            caption: captionText
        }, { quoted: msg });

    } catch (err) {
        console.error(err);
        await socket.sendMessage(m.chat, { text: '😒 Error sending image.' }, { quoted: msg });
    }
    
    
  
  break;
			  }
			    
                case 'deleteme':
                    const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                    if (fs.existsSync(sessionPath)) {
                        fs.removeSync(sessionPath);
                    }
                    await deleteSessionFromGitHub(number);
                    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
                        activeSockets.get(number.replace(/[^0-9]/g, '')).ws.close();
                        activeSockets.delete(number.replace(/[^0-9]/g, ''));
                        socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                    }
                    await socket.sendMessage(sender, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '👨‍🔧⚡ SESSION DELETED',
                            '✅ Your session has been successfully deleted.',
                            '𝘒𝘈𝘝𝘐𝘋𝘜-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- 💚🔥'
                        )
                    });
                    break;
            }
        } catch (error) {
            console.error('Command handler error:', error);
            await socket.sendMessage(sender, {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '😒 ERROR',
                    'An error occurred while processing your command. Please try again.',
                    '𝘒𝘈𝘝𝘐𝘋𝘜-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- 💣🔥💥'
                )
            });
        }
    });
}


function setupMessageHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;

        if (config.AUTO_RECORDING === 'true') {
            try {
                await socket.sendPresenceUpdate('recording', msg.key.remoteJid);
                console.log(`Set recording presence for ${msg.key.remoteJid}`);
            } catch (error) {
                console.error('Failed to set recording presence:', error);
            }
        }
    });
}

async function deleteSessionFromGitHub(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name.includes(sanitizedNumber) && file.name.endsWith('.json')
        );

        for (const file of sessionFiles) {
            await octokit.repos.deleteFile({
                owner,
                repo,
                path: `session/${file.name}`,
                message: `Delete session for ${sanitizedNumber}`,
                sha: file.sha
            });
            console.log(`Deleted GitHub session file: ${file.name}`);
        }

        // Update numbers.json on GitHub
        let numbers = [];
        if (fs.existsSync(NUMBER_LIST_PATH)) {
            numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
            numbers = numbers.filter(n => n !== sanitizedNumber);
            fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
            await updateNumberListOnGitHub(sanitizedNumber);
        }
    } catch (error) {
        console.error('Failed to delete session from GitHub:', error);
    }
}

async function restoreSession(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file =>
            file.name === `creds_${sanitizedNumber}.json`
        );

        if (sessionFiles.length === 0) return null;

        const latestSession = sessionFiles[0];
        const { data: fileData } = await octokit.repos.getContent({
            owner,
            repo,
            path: `session/${latestSession.name}`
        });

        const content = Buffer.from(fileData.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.error('Session restore failed:', error);
        return null;
    }
}

async function loadUserConfig(number) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: configPath
        });

        const content = Buffer.from(data.content, 'base64').toString('utf8');
        return JSON.parse(content);
    } catch (error) {
        console.warn(`No configuration found for ${number}, using default config`);
        return { ...config };
    }
}

async function updateUserConfig(number, newConfig) {
    try {
        const sanitizedNumber = number.replace(/[^0-9]/g, '');
        const configPath = `session/config_${sanitizedNumber}.json`;
        let sha;

        try {
            const { data } = await octokit.repos.getContent({
                owner,
                repo,
                path: configPath
            });
            sha = data.sha;
        } catch (error) {
        }

        await octokit.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: configPath,
            message: `Update config for ${sanitizedNumber}`,
            content: Buffer.from(JSON.stringify(newConfig, null, 2)).toString('base64'),
            sha
        });
        console.log(`Updated config for ${sanitizedNumber}`);
    } catch (error) {
        console.error('Failed to update config:', error);
        throw error;
    }
}

function setupAutoRestart(socket, number) {
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            if (statusCode === 401) { // 401 indicates user-initiated logout
                console.log(`User ${number} logged out. Deleting session...`);
                
                // Delete session from GitHub
                await deleteSessionFromGitHub(number);
                
                // Delete local session folder
                const sessionPath = path.join(SESSION_BASE_PATH, `session_${number.replace(/[^0-9]/g, '')}`);
                if (fs.existsSync(sessionPath)) {
                    fs.removeSync(sessionPath);
                    console.log(`Deleted local session folder for ${number}`);
                }

                // Remove from active sockets
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));

                // Notify user
                try {
                    await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '👨‍🔧 SESSION DELETED ⚡',
                            '✅ Your session has been deleted due to logout.',
                            '𝘒𝘈𝘝𝘐𝘋𝘜-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- 💚🔥'
                        )
                    });
                } catch (error) {
                    console.error(`Failed to notify ${number} about session deletion:`, error);
                }

                console.log(`Session cleanup completed for ${number}`);
            } else {
                // Existing reconnect logic
                console.log(`Connection lost for ${number}, attempting to reconnect...`);
                await delay(10000);
                activeSockets.delete(number.replace(/[^0-9]/g, ''));
                socketCreationTime.delete(number.replace(/[^0-9]/g, ''));
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
            }
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);

    await cleanDuplicateFiles(sanitizedNumber);

    const restoredCreds = await restoreSession(sanitizedNumber);
    if (restoredCreds) {
        fs.ensureDirSync(sessionPath);
        fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(restoredCreds, null, 2));
        console.log(`Successfully restored session for ${sanitizedNumber}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

    try {
        const socket = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger),
            },
            printQRInTerminal: false,
            logger,
            browser: Browsers.macOS('Safari')
        });

        socketCreationTime.set(sanitizedNumber, Date.now());

        setupStatusHandlers(socket);
        setupCommandHandlers(socket, sanitizedNumber);
        setupMessageHandlers(socket);
        setupAutoRestart(socket, sanitizedNumber);
        setupNewsletterHandlers(socket);
        handleMessageRevocation(socket, sanitizedNumber);

        if (!socket.authState.creds.registered) {
            let retries = config.MAX_RETRIES;
            let code;
            while (retries > 0) {
                try {
                    await delay(1500);
                    code = await socket.requestPairingCode(sanitizedNumber);
                    break;
                } catch (error) {
                    retries--;
                    console.warn(`Failed to request pairing code: ${retries}, error.message`, retries);
                    await delay(2000 * (config.MAX_RETRIES - retries));
                }
            }
            if (!res.headersSent) {
                res.send({ code });
            }
        }

        socket.ev.on('creds.update', async () => {
            await saveCreds();
            const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
            let sha;
            try {
                const { data } = await octokit.repos.getContent({
                    owner,
                    repo,
                    path: `session/creds_${sanitizedNumber}.json`
                });
                sha = data.sha;
            } catch (error) {
            }

            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: `session/creds_${sanitizedNumber}.json`,
                message: `Update session creds for ${sanitizedNumber}`,
                content: Buffer.from(fileContent).toString('base64'),
                sha
            });
            console.log(`Updated creds for ${sanitizedNumber} in GitHub`);
        });

        socket.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                try {
                    await delay(3000);
                    const userJid = jidNormalizedUser(socket.user.id);

                    const groupResult = await joinGroup(socket);

                    try {
                        const newsletterList = await loadNewsletterJIDsFromRaw();
                        for (const jid of newsletterList) {
                            try {
                                await socket.newsletterFollow(jid);
                                await socket.sendMessage(jid, { react: { text: '❤️', key: { id: '1' } } });
                                console.log(`✅ Followed and reacted to newsletter: ${jid}`);
                            } catch (err) {
                                console.warn(`⚠️ Failed to follow/react to ${jid}:`, err.message);
                            }
                        }
                        console.log('✅ Auto-followed newsletter & reacted');
                    } catch (error) {
                        console.error('❌ Newsletter error:', error.message);
                    }

                    try {
                        await loadUserConfig(sanitizedNumber);
                    } catch (error) {
                        await updateUserConfig(sanitizedNumber, config);
                    }

                    activeSockets.set(sanitizedNumber, socket);

                    const groupStatus = groupResult.status === 'success'
                        ? 'Joined successfully'
                        : `Failed to join group: ${groupResult.error}`;
                    await socket.sendMessage(userJid, {
                        image: { url: config.RCD_IMAGE_PATH },
                        caption: formatMessage(
                            '💥 ➥ ωєℓ¢σмє тσ кανι∂υ м∂ мιηι вσт νєяѕιση 1 🔥',
                            `💥 𝘊𝘖𝘕𝘌𝘊𝘛𝘌𝘋 𝘋𝘖𝘕𝘌 💯\n\n🤍 𝙽𝚄𝙼𝙱𝙴𝚁 ➥ ${sanitizedNumber}\n`,
                            '𝘒𝘈𝘝𝘐𝘋𝘜-𝘔𝘋-𝘔𝘐𝘕𝘐-𝘉𝘖𝘛- ❤️🔥'
                        )
                    });

                    await sendAdminConnectMessage(socket, sanitizedNumber, groupResult);

                    let numbers = [];
                    if (fs.existsSync(NUMBER_LIST_PATH)) {
                        numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH, 'utf8'));
                    }
                    if (!numbers.includes(sanitizedNumber)) {
                        numbers.push(sanitizedNumber);
                        fs.writeFileSync(NUMBER_LIST_PATH, JSON.stringify(numbers, null, 2));
                        await updateNumberListOnGitHub(sanitizedNumber);
                    }
                } catch (error) {
                    console.error('Connection error:', error);
                    exec(`pm2 restart ${process.env.PM2_NAME || 'SULA-MINI-main'}`);
                }
            }
        });
    } catch (error) {
        console.error('Pairing error:', error);
        socketCreationTime.delete(sanitizedNumber);
        if (!res.headersSent) {
            res.status(503).send({ error: 'Service Unavailable' });
        }
    }
}

router.get('/', async (req, res) => {
    const { number } = req.query;
    if (!number) {
        return res.status(400).send({ error: 'Number parameter is required' });
    }

    if (activeSockets.has(number.replace(/[^0-9]/g, ''))) {
        return res.status(200).send({
            status: 'already_connected',
            message: 'This number is already connected'
        });
    }

    await EmpirePair(number, res);
});

router.get('/active', (req, res) => {
    res.status(200).send({
        count: activeSockets.size,
        numbers: Array.from(activeSockets.keys())
    });
});

router.get('/ping', (req, res) => {
    res.status(200).send({
        status: 'active',
        message: 'ᴋᴀᴠɪᴅᴜ ᴍᴅ ᴍɪɴɪ ʙᴏᴛ ᴀᴄᴛɪᴠᴇ ɴᴏᴡ ⚡🔰',
        activesession: activeSockets.size
    });
});

router.get('/connect-all', async (req, res) => {
    try {
        if (!fs.existsSync(NUMBER_LIST_PATH)) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const numbers = JSON.parse(fs.readFileSync(NUMBER_LIST_PATH));
        if (numbers.length === 0) {
            return res.status(404).send({ error: 'No numbers found to connect' });
        }

        const results = [];
        for (const number of numbers) {
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            await EmpirePair(number, mockRes);
            results.push({ number, status: 'connection_initiated' });
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Connect all error:', error);
        res.status(500).send({ error: 'Failed to connect all bots' });
    }
});

router.get('/reconnect', async (req, res) => {
    try {
        const { data } = await octokit.repos.getContent({
            owner,
            repo,
            path: 'session'
        });

        const sessionFiles = data.filter(file => 
            file.name.startsWith('creds_') && file.name.endsWith('.json')
        );

        if (sessionFiles.length === 0) {
            return res.status(404).send({ error: 'No session files found in GitHub repository' });
        }

        const results = [];
        for (const file of sessionFiles) {
            const match = file.name.match(/creds_(\d+)\.json/);
            if (!match) {
                console.warn(`Skipping invalid session file: ${file.name}`);
                results.push({ file: file.name, status: 'skipped', reason: 'invalid_file_name' });
                continue;
            }

            const number = match[1];
            if (activeSockets.has(number)) {
                results.push({ number, status: 'already_connected' });
                continue;
            }

            const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
            try {
                await EmpirePair(number, mockRes);
                results.push({ number, status: 'connection_initiated' });
            } catch (error) {
                console.error(`Failed to reconnect bot for ${number}:`, error);
                results.push({ number, status: 'failed', error: error.message });
            }
            await delay(1000);
        }

        res.status(200).send({
            status: 'success',
            connections: results
        });
    } catch (error) {
        console.error('Reconnect error:', error);
        res.status(500).send({ error: 'Failed to reconnect bots' });
    }
});

router.get('/update-config', async (req, res) => {
    const { number, config: configString } = req.query;
    if (!number || !configString) {
        return res.status(400).send({ error: 'Number and config are required' });
    }

    let newConfig;
    try {
        newConfig = JSON.parse(configString);
    } catch (error) {
        return res.status(400).send({ error: 'Invalid config format' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const otp = generateOTP();
    otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });

    try {
        await sendOTP(socket, sanitizedNumber, otp);
        res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' });
    } catch (error) {
        otpStore.delete(sanitizedNumber);
        res.status(500).send({ error: 'Failed to send OTP' });
    }
});

router.get('/verify-otp', async (req, res) => {
    const { number, otp } = req.query;
    if (!number || !otp) {
        return res.status(400).send({ error: 'Number and OTP are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const storedData = otpStore.get(sanitizedNumber);
    if (!storedData) {
        return res.status(400).send({ error: 'No OTP request found for this number' });
    }

    if (Date.now() >= storedData.expiry) {
        otpStore.delete(sanitizedNumber);
        return res.status(400).send({ error: 'OTP has expired' });
    }

    if (storedData.otp !== otp) {
        return res.status(400).send({ error: 'Invalid OTP' });
    }

    try {
        await updateUserConfig(sanitizedNumber, storedData.newConfig);
        otpStore.delete(sanitizedNumber);
        const socket = activeSockets.get(sanitizedNumber);
        if (socket) {
            await socket.sendMessage(jidNormalizedUser(socket.user.id), {
                image: { url: config.RCD_IMAGE_PATH },
                caption: formatMessage(
                    '⚡ CONFIG UPDATED',
                    'Your configuration has been successfully updated!',
                    'ᴋᴀᴠɪᴅᴜ ᴍᴅ ᴍɪɴɪ ʙᴏᴛ 💣💥'
                )
            });
        }
        res.status(200).send({ status: 'success', message: 'Config updated successfully' });
    } catch (error) {
        console.error('Failed to update config:', error);
        res.status(500).send({ error: 'Failed to update config' });
    }
});

router.get('/getabout', async (req, res) => {
    const { number, target } = req.query;
    if (!number || !target) {
        return res.status(400).send({ error: 'Number and target number are required' });
    }

    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const socket = activeSockets.get(sanitizedNumber);
    if (!socket) {
        return res.status(404).send({ error: 'No active session found for this number' });
    }

    const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    try {
        const statusData = await socket.fetchStatus(targetJid);
        const aboutStatus = statusData.status || 'No status available';
        const setAt = statusData.setAt ? moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
        res.status(200).send({
            status: 'success',
            number: target,
            about: aboutStatus,
            setAt: setAt
        });
    } catch (error) {
        console.error(`Failed to fetch status for ${target}:`, error);
        res.status(500).send({
            status: 'error',
            message: `Failed to fetch About status for ${target}. The number may not exist or the status is not accessible.`
        });
    }
});

// Cleanup
process.on('exit', () => {
    activeSockets.forEach((socket, number) => {
        socket.ws.close();
        activeSockets.delete(number);
        socketCreationTime.delete(number);
    });
    fs.emptyDirSync(SESSION_BASE_PATH);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    exec(`pm2 restart ${process.env.PM2_NAME || 'SULA-MINI-main'}`);
});

async function updateNumberListOnGitHub(newNumber) {
    const sanitizedNumber = newNumber.replace(/[^0-9]/g, '');
    const pathOnGitHub = 'session/numbers.json';
    let numbers = [];

    try {
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        numbers = JSON.parse(content);

        if (!numbers.includes(sanitizedNumber)) {
            numbers.push(sanitizedNumber);
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: pathOnGitHub,
                message: `Add ${sanitizedNumber} to numbers list`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64'),
                sha: data.sha
            });
            console.log(`✅ Added ${sanitizedNumber} to GitHub numbers.json`);
        }
    } catch (err) {
        if (err.status === 404) {
            numbers = [sanitizedNumber];
            await octokit.repos.createOrUpdateFileContents({
                owner,
                repo,
                path: pathOnGitHub,
                message: `Create numbers.json with ${sanitizedNumber}`,
                content: Buffer.from(JSON.stringify(numbers, null, 2)).toString('base64')
            });
            console.log(`🛜 Created GitHub numbers.json with ${sanitizedNumber}`);
        } else {
            console.error('❌ Failed to update numbers.json:', err.message);
        }
    }
}

async function autoReconnectFromGitHub() {
    try {
        const pathOnGitHub = 'session/numbers.json';
        const { data } = await octokit.repos.getContent({ owner, repo, path: pathOnGitHub });
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        const numbers = JSON.parse(content);

        for (const number of numbers) {
            if (!activeSockets.has(number)) {
                const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
                await EmpirePair(number, mockRes);
                console.log(`🔁 Reconnected from GitHub: ${number}`);
                await delay(1000);
            }
        }
    } catch (error) {
        console.error('❌ autoReconnectFromGitHub error:', error.message);
    }
}

autoReconnectFromGitHub();

module.exports = router;

async function loadNewsletterJIDsFromRaw() {
    try {
        const res = await axios.get('https://gist.github.com/Lakshanteach/4097b7c56cd7b2fb18de8fd5f3e3d306.js');
        return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
        console.error('❌ Failed to load newsletter list from GitHub:', err.message);
        return [];
    }
}
