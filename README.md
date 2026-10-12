# 🏚️ Senhorio

*O jogo de cartas da crise da habitação.*

Uma recriação do Monopoly Deal em versão satírica, multijogador no browser: és um
senhorio a competir com amigos (e com um Fundo Abutre, uma Tia com Alojamento Local
ou um Nómada Digital) para ver quem junta primeiro **3 conjuntos completos de cores
diferentes**. Feito para alojares no teu servidor e jogares com amigos à distância.

## Arrancar

Precisas de Node.js 18 ou mais recente. Não há dependências para instalar.

```sh
node server.js
```

Abre `http://localhost:3000`. Para mudar a porta:

```sh
PORT=8080 node server.js
```

Com Docker:

```sh
docker build -t senhorio .
docker run -p 3000:3000 senhorio
```

Ou com `docker compose up -d`, que liga o contentor à rede externa `tunnel_net`
do túnel da Cloudflare (igual ao Hexis).

## Jogar

Uma pessoa carrega em **Criar mesa** e passa aos outros o código de quatro
letras (o botão do código copia o link direto). Os outros entram com esse
código. Entre 2 e 5 jogadores. O anfitrião começa a partida quando estiverem
todos — depois de começar já não entra mais ninguém. A ordem da mesa é sorteada.

Na sala de espera, o anfitrião pode carregar em **Adicionar bot** para juntar
adversários controlados pelo computador, e tirá-los com o × ao lado do nome. Dá
para jogar sozinho contra bots ou completar uma mesa com amigos. Os bots jogam no
servidor e, se não houver ninguém ligado à mesa, ficam à espera.

Se alguém fechar o separador ou perder a rede, volta a abrir o mesmo link e
entra de novo no lugar dele: a sessão fica guardada no browser. Enquanto não
volta, a mesa espera por ele. Quem carregar em **Sair da mesa** a meio do jogo
deixa o lugar a um bot, para a partida não encravar. No fim, o anfitrião pode
carregar em **Jogar outra vez** (ou **Novo jogo**) para voltar à sala de espera
com os mesmos jogadores. As mesas sem atividade são apagadas ao fim de seis horas.

## Atrás de um proxy

O jogo usa WebSocket na mesma porta do site, por isso o proxy tem de deixar
passar o upgrade. Em nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
}
```

Em Caddy basta `reverse_proxy 127.0.0.1:3000`. Com HTTPS o cliente passa
sozinho para `wss://`.

O servidor guarda tudo em memória: reiniciar o processo apaga as partidas a
decorrer.

## Regras (iguais às do Monopoly Deal)

- No início da vez compras 2 cartas (5 se a mão estiver vazia).
- Até 3 jogadas por vez: depositar no banco, jogar propriedades ou usar ações.
- Máximo de 7 cartas na mão no fim da vez.
- Os pagamentos saem do banco e/ou das propriedades da mesa. Não há troco.
- Os curingas podem mudar de cor durante a tua vez, sem gastar jogada.

| Monopoly Deal    | Senhorio             |
|------------------|----------------------|
| Deal Breaker     | 🦅 Fundo Abutre        |
| Just Say No      | ⚖️ Providência Cautelar |
| Sly Deal         | 🛂 Golden Visa         |
| Forced Deal      | 🤝 Permuta Duvidosa    |
| Debt Collector   | 📨 Cobrador do Fraque  |
| It's My Birthday | 🛗 Taxa de Condomínio  |
| Pass Go          | 👵 Herança da Avó      |
| Double The Rent  | 📈 Atualização da Renda |
| House            | 🔨 Remodelação Low-Cost |
| Hotel            | 🧳 Alojamento Local    |

| Cor          | Conjunto         | Propriedades                              |
|--------------|------------------|-------------------------------------------|
| Castanho     | Periferia        | Cave em Odivelas, Quarto na Amadora       |
| Azul claro   | Margem Sul       | T1 no Barreiro, Garagem no Seixal, Anexo em Almada |
| Rosa         | Bairros Hipster  | Arroios, Intendente, Anjos                |
| Laranja      | Invicta          | Bonfim, Cedofeita, Ribeira                |
| Vermelho     | Lisboa Típica    | Alfama, Mouraria, Graça                   |
| Amarelo      | Centro Chique    | Chiado, Príncipe Real, Bairro Alto        |
| Verde        | Linha de Cascais | Carcavelos, Estoril, Cascais              |
| Azul escuro  | Resorts de Luxo  | Comporta, Quinta do Lago                  |
| Estações     | Transportes      | Linha de Sintra, Cacilheiro, Metro, Autocarro 728 |
| Serviços     | Contadores       | Contador da Luz, Contador da Água         |

## Como está organizado

```
server.js          HTTP, ficheiros estáticos, salas, ligação dos jogadores
src/ws.js          WebSocket em Node puro (RFC 6455), sem dependências
src/game.js        Regras e fluxo do jogo, validação das jogadas
src/bot.js         Adversários controlados pelo computador
public/rules.js    Baralho (106 cartas) e regras partilhadas entre servidor e browser
public/app.js      Cliente: entrada, sala de espera, mesa e pedidos
public/style.css   Estilos
```

O servidor é a única autoridade sobre o estado. Cada jogador recebe uma versão
do estado onde só vê a sua própria mão; dos outros vê apenas quantas cartas têm.
As decisões fora da vez (pagar, descartar, usar uma Providência Cautelar) chegam
ao browser como pedidos, e todas as jogadas e respostas são validadas no
servidor, por isso mexer no cliente não dá vantagem nenhuma.

Para depurar no browser, `window.__s` tem o último estado recebido.
