# My Collection

Hub desktop (Electron + Angular) para organizar e iniciar os apps que eu desenvolvo.

## Requisitos

- Node.js 22.12+ ou 24 (o CI usa a versão do `.nvmrc`)
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

## Apps com o contrato do hub

Apps feitos para o My Collection, como a [Minha Livraria](https://github.com/BrunaSanguini/MyLibrary), seguem um contrato. No formulário, marque **Este app segue o contrato do hub** (ou use **Começar de um modelo → Minha Livraria**):

| Etapa | O que o hub faz |
| --- | --- |
| Porta | Usa a da URL se estiver livre; senão, qualquer livre. Passa como `--server.port=<porta>` |
| Token | Gera um token novo a cada sessão e entrega na variável de ambiente do formulário (ex.: `MINHA_LIVRARIA_SHUTDOWN_TOKEN`) |
| Pronto | Pergunta a readiness (`/actuator/health/readiness`) com pausa de 200 ms que dobra até 2 s, até `{"status":"UP"}` |
| Uma cópia só | Se o hub fechou com o app aberto, reaproveita a sessão em vez de abrir outro. Se já há uma cópia aberta fora do hub, avisa e não inicia |
| PARAR | `POST /actuator/shutdown` com o token no cabeçalho `X-MyCollection-Token` e espera o app fechar sozinho (até 30 s). Só então encerra à força |
| Fechar o hub | Faz o mesmo PARAR em cada app de contrato |

Porta e token da sessão ficam em `%APPDATA%\My Collection\sessions.json`, apagados ao parar.

### Cadastrar a Minha Livraria

1. Baixe o `minha-livraria-X.Y.Z-windows-x64.zip` da [última versão](https://github.com/BrunaSanguini/MyLibrary/releases/latest) e extraia (ex.: `C:\Apps`).
2. No hub: **Adicionar app → Começar de um modelo → Minha Livraria**.
3. Em **Diretório do projeto**, escolha a pasta com o `MinhaLivraria.exe` (ex.: `C:\Apps\MinhaLivraria`) e salve.
4. **INICIAR** abre o navegador quando o app fica pronto; **PARAR** fecha o app sem perder dados.

### Atualizar a Minha Livraria

O hub lê a versão instalada (`app\MinhaLivraria.cfg`) e procura a última release no GitHub ao abrir e ao salvar o app. Quando há uma versão nova, o destaque mostra **Nova versão X.Y.Z** e o botão **Atualizar**, que:

1. fecha o app pelo shutdown, se ele estiver aberto;
2. baixa o zip para `%APPDATA%\My Collection\updates` e confere o `.sha256` da release (sem o `.sha256`, ou se não bater, não instala);
3. extrai ao lado da pasta e troca as duas: a versão anterior fica em `<pasta>.anterior` até a próxima atualização;
4. abre o app de novo, se ele estava aberto.

Os dados ficam em `%USERPROFILE%\.minha-livraria`, fora da pasta do app, e não são tocados. Se algo falhar antes da troca, a versão que já estava instalada continua lá (e volta a abrir).

## Testes

```bash
npm test            # Vitest: contrato do hub, sessões, validação e o ProcessManager com um app falso
npm run typecheck   # TypeScript do processo principal
```

O CI também baixa o zip da última release da Minha Livraria num runner Windows e roda `electron/launcher/minha-livraria.e2e.test.ts`: inicia pelo hub, grava um livro, fecha pelo shutdown e confere o livro na sessão seguinte. Para rodar no seu Windows:

```powershell
$env:MINHA_LIVRARIA_DIR = 'C:\Apps\MinhaLivraria'
npx vitest run minha-livraria
```

No mesmo job, `electron/updates/atualiza-livraria.e2e.test.ts` abre a 1.0.0 pelo hub e a atualiza para a última release com o botão Atualizar de verdade (`AppUpdater`).

## Estrutura

```
shared/
  library.ts       tipos + validação usados pelo Electron e pelo Angular
  process.ts       estados e eventos de execução
  settings.ts      configurações + validação
  templates.ts     modelos de apps prontos (Minha Livraria)
  updates.ts       de onde vêm as versões, comparação e andamento da atualização
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
    hub-contract.ts        porta, token, readiness e shutdown do contrato do hub
    session-store.ts       sessions.json: porta e token dos apps de contrato em execução
    app-windows.ts         janelas próprias dos apps (sem acesso ao hub)
  updates/
    app-updater.ts         confere a última release, baixa, confere o SHA-256 e troca a pasta
    zip.ts                 extrai o zip sem deixar sair da pasta
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
- [x] **Etapa 5** — Contrato do hub (porta, token, readiness, shutdown), modelo da Minha Livraria e testes
- [x] **Etapa 6** — Atualizar a Minha Livraria pelo hub (release do GitHub, SHA-256, troca da pasta)
