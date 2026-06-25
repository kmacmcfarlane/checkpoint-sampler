# Project-specific tools for checkpoint-sampler
FROM claude-sandbox

# Go toolchain
RUN curl -fsSL https://go.dev/dl/go1.25.6.linux-amd64.tar.gz | tar -C /usr/local -xz
ENV PATH="/usr/local/go/bin:$PATH"

# TypeScript / Vue language servers
RUN npm install -g typescript-language-server typescript && \
    npm install -g @vtsls/language-server

# Python LSP (Python 3 + venv already in base image)
RUN npm install -g pyright

# Go language server (install as claude user so it lands in ~/go/bin)
USER claude
RUN go install golang.org/x/tools/gopls@latest
USER root
ENV PATH="/home/claude/go/bin:$PATH"
