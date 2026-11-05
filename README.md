# My Collection

Hub desktop (Electron + Angular) para organizar e iniciar os apps que eu desenvolvo.

## Requisitos

- Node.js 20.19+ ou 22.12+ (recomendado: 22 LTS)
- npm 10+

## Rodando

```bash
npm install
npm run dev        # ng serve + janela Electron com hot reload
```

## Instalar no Windows (app empacotado)

```bash
npm install          # instala o electron-builder (só na primeira vez)
npm run dist         # gera release/My Collection Setup <versão>.exe
```

Rode o instalador gerado em `release/`. Ele cria atalhos na Área de Trabalho e no Menu Iniciar.
Como o app não é assinado digitalmente, o Windows SmartScreen pode avisar na primeira vez: **Mais informações → Executar assim mesmo**.

- `npm run dist:dir` gera só a pasta `release/win-unpacked/` (abre `My Collection.exe` direto, sem instalar) — bom para testar.
- Para lançar uma nova versão, aumente `"version"` no `package.json` antes do `npm run dist`.
- Desinstalar **não** apaga seus dados (`%APPDATA%\My Collection`).

Outros scripts:

| Script | O que faz |
| --- | --- |
| `npm run dev` | Sobe o Angular em `localhost:4200` e abre o Electron apontando para ele (DevTools destacado) |
| `npm run build` | Build do Angular (`dist/`) + compila o Electron (`dist-electron/`) |
| `npm run electron` | Build completo e abre o app como em produção |
| `npm run ng -- serve` | Só o Angular no navegador (sem Electron) |
| `npm run dist` | Gera o instalador Windows (`release/`) |
| `npm run dist:dir` | Gera o app sem instalador (`release/win-unpacked/`) |

## Onde ficam os dados

Tudo fica em `%APPDATA%\My Collection\`:

| Arquivo | Conteúdo |
| --- | --- |
| `library.json` | apps e pastas |
| `settings.json` | configurações (abrir com o Windows, confirmar ao fechar, tempo de espera da URL) |
| `icons/` | imagens personalizadas dos apps (cópias; as não usadas são apagadas ao abrir o hub) |

Em **Configurações → Dados** dá para abrir essa pasta, **exportar** um backup (`.json`) e **importar** um backup.

Se o arquivo for corrompido (ex.: edição manual com erro), ele é guardado como `library.corrupt-<data>.json` e o app recomeça com as pastas padrão.
Rodando só `ng serve` no navegador (sem Electron), os dados vão para o `localStorage`.

## Como o INICIAR funciona

1. O hub roda o **comando de inicialização** no **diretório do projeto** (via shell, como no terminal).
2. Se o app tem **URL**, o hub espera ela responder e então abre em **janela própria** ou no **navegador** (conforme "Abrir em").
   Sem URL, o app é considerado rodando assim que o processo sobe.
3. **PARAR** encerra o processo e todos os filhos (`taskkill /T` no Windows). Se houver **comando para parar**, ele roda em seguida.
4. Apps **em segundo plano** (tipo Docker ou com comando para parar, ex.: `docker compose up -d`): quando o comando
   termina com sucesso, o app continua "Em execução" e o PARAR usa o comando para parar (ex.: `docker compose down`).
5. Fechar o My Collection encerra os processos que ele iniciou. Containers em segundo plano continuam rodando.

Dicas:
- A variável `BROWSER=none` é passada aos apps para que CLIs como Vite/CRA não abram o navegador sozinhas.
- Para `ng serve`, deixe a URL como `http://localhost:4200` — e não rode dois apps na mesma porta (o hub avisa nos logs).
- Os logs ficam em memória (últimas 1000 linhas por app) e somem ao fechar o hub.

## Estrutura

```
shared/
  library.ts       tipos + validação usados pelo Electron e pelo Angular
  process.ts       estados e eventos de execução
  settings.ts      configurações + validação
build/             ícone do app (icon.svg → icon.png / icon.ico)
electron-builder.yml  configuração do instalador (NSIS)
electron/
  main.ts          processo principal: janela, IPC
  preload.ts       ponte segura (window.myCollection)
  storage/
    json-file.ts           JSON com escrita atômica + backup se corromper
    library-repository.ts  LibraryRepository + JsonLibraryRepository
    icon-store.ts          imagens dos apps (protocolo mc-icon://)
  launcher/
    process-manager.ts     inicia/para processos, logs, espera a URL responder
    app-windows.ts         janelas próprias dos apps (sem acesso ao hub)
src/app/
  core/
    models.ts      AppEntry, Folder, tipos e labels
    library.gateway.ts  Electron (IPC) ou localStorage, escolhido em runtime
    process.gateway.ts  processos reais (Electron) ou simulados (navegador)
    apps.store.ts  estado com signals (filtros, seleção, status, CRUD, persistência, backup)
    settings.service.ts configurações (settings.json ou localStorage)
    electron-api.ts contrato tipado do preload
  components/
    sidebar/       barra lateral recolhível (busca, pastas, ações)
    app-hero/      destaque do app selecionado + INICIAR/PARAR
    app-grid/      grade de ícones
    app-dialog/    formulário adicionar/editar
    app-logs/      painel de logs estilo terminal
    app-avatar/    ícone do app (imagem ou iniciais coloridas)
    settings-dialog/ tela de Configurações
    icon/          ícones SVG
```

## Roadmap

- [x] **Etapa 1** — Scaffold Angular + Electron e interface do protótipo (dados em memória, execução simulada)
- [x] **Etapa 2** — Persistência em JSON (`userData`) via IPC, CRUD de pastas, excluir app, seletor de diretório
- [x] **Etapa 3** — Launcher real: `child_process` por app, status, parar, logs, abrir janela/navegador
- [x] **Etapa 4** — Empacotamento (electron-builder), ícones personalizados, configurações, backup
