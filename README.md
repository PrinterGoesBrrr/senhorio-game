# 🏚️ Senhorio

*O jogo de cartas da crise da habitação.*

Uma recriação do Monopoly Deal em versão satírica: és um senhorio a competir com um
Fundo Abutre, uma Tia com Alojamento Local e um Nómada Digital para ver quem junta
primeiro **3 conjuntos completos de cores diferentes**.

## Como jogar

Não precisa de instalar nada: abre o `index.html` no browser.

Escolhe 1 a 4 adversários (controlados pelo computador) e começa a especular.

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

## Estrutura

- `js/cards.js`: definição do baralho (106 cartas)
- `js/engine.js`: regras e fluxo do jogo
- `js/ai.js`: adversários controlados pelo computador
- `js/ui.js`: interface e jogadas do jogador humano
- `css/style.css`: estilos
