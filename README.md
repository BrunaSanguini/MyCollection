# My Collection

Hub desktop que reúne os apps que eu desenvolvo e os inicia com um clique. Cada app roda na própria máquina e abre no navegador padrão.

> **Status:** começando pelo `launcher`, a peça que inicia e encerra os apps. A interface (Electron + Angular) vem depois.

## Launcher

Módulo em TypeScript, para o processo principal do Electron, em [`src/launcher`](src/launcher). Ele segue o contrato que os apps locais cumprem, definido no [ADR-0001 da Minha Livraria](https://github.com/BrunaSanguini/MyLibrary/blob/main/docs/adr/0001-arquitetura-macro.md):

| Passo | Como funciona |
|---|---|
| Uma instância por vez | Antes de iniciar, consulta a readiness da sessão salva e da porta padrão. Se o app responde, só abre o navegador. |
| Porta | A padrão do app (8471 na Minha Livraria), ou outra livre se estiver ocupada, passada com `--server.port`. |
| Token | Um token aleatório por sessão, entregue por variável de ambiente (`MINHA_LIVRARIA_SHUTDOWN_TOKEN`). |
| Readiness | `GET /actuator/health/readiness` até `UP`, com pausa que dobra até 2 s. Desiste em 120 s ou se o processo terminar antes. |
| Navegador | Abre `http://127.0.0.1:<porta>/` quando o app está pronto. |
| Encerramento | `POST /actuator/shutdown` com o token no header `X-MyCollection-Token`, para o app fechar o banco. Encerramento forçado (`taskkill /F /T`) só se o app não terminar em 30 s. |
| Sessões | Porta, token e pid ficam num arquivo JSON. Se o hub for fechado e aberto de novo com o app rodando, ele ainda consegue encerrá-lo. |

Um app iniciado fora do hub (pelo terminal, por exemplo) é reconhecido pela readiness: o hub abre o navegador, mas não o encerra, porque não tem o token.

```ts

import path from 'node:path';
import { app, shell } from 'electron';
import { AppLauncher, minhaLivraria, nodeSystem, SessionStore } from './launcher';

const launcher = new AppLauncher(
  nodeSystem((url) => shell.openExternal(url)),
  new SessionStore(path.join(app.getPath('userData'), 'sessions.json')),
);
const livraria = minhaLivraria('C:\\Apps\\MinhaLivraria\\MinhaLivraria.exe');

await launcher.open(livraria);  // inicia, espera ficar pronto e abre o navegador
await launcher.close(livraria); // 'graceful', 'forced' ou 'not-running'
```

## Desenvolvimento

Requer Node.js 22 ou mais novo.

```bash
npm ci
npm test           # Vitest
npm run typecheck  # TypeScript
```

Os testes usam um sistema falso em memória (processos, portas, navegador e relógio). Nenhum teste inicia um app de verdade nem abre o navegador. O teste de ponta a ponta com o executável real fica no repositório da Minha Livraria (`frontend/e2e/hub-contract.spec.ts`).
