#!/data/data/com.termux/files/usr/bin/bash

# Konfigurasi
SESSION_NAME="botwa"
BOT_DIR="$HOME/botwa"

# Warna ANSI
GREEN='\033[1;32m'
WHITE='\033[1;37m'
CYAN='\033[1;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Cek apakah session tmux sudah berjalan
tmux has-session -t "$SESSION_NAME" 2>/dev/null

if [ $? -eq 0 ]; then
    # Jika session sudah aktif
    echo -e "${CYAN}╔════════════════════════════════════════════╗"
    echo -e "║${GREEN}  ✅ Bot WA sudah berjalan di tmux: ${SESSION_NAME}  ${CYAN}║"
    echo -e "║${WHITE}     Untuk masuk: tmux attach -t ${SESSION_NAME}     ${CYAN}║"
    echo -e "╚════════════════════════════════════════════╝${NC}"
else
    # Jika belum aktif, jalankan bot
    tmux new-session -d -s "$SESSION_NAME" "cd $BOT_DIR && node index.js"

    echo -e "${CYAN}╔════════════════════════════════════════════╗"
    echo -e "║${GREEN}  🚀 Bot WA berhasil diaktifkan via tmux!     ${CYAN}║"
    echo -e "║${WHITE}     Session: ${GREEN}${SESSION_NAME}${WHITE}                              ${CYAN}║"
    echo -e "║${WHITE}     Untuk masuk: tmux attach -t ${SESSION_NAME}     ${CYAN}║"
    echo -e "║${YELLOW}     Tekan CTRL + B lalu D untuk keluar tmux  ${CYAN}║"
    echo -e "╚════════════════════════════════════════════╝${NC}"
fi
