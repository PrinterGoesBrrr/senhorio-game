// Senhorio — definições das cartas (baseado no baralho do Monopoly Deal, 106 cartas)

const COLORS = {
  brown:     { name: 'Periferia',        hex: '#7b4a2a', text: '#fff', size: 2, rent: [1, 2] },
  lightblue: { name: 'Margem Sul',       hex: '#8ecae6', text: '#111', size: 3, rent: [1, 2, 3] },
  pink:      { name: 'Bairros Hipster',  hex: '#e05a9b', text: '#fff', size: 3, rent: [1, 2, 4] },
  orange:    { name: 'Invicta',          hex: '#f08a24', text: '#111', size: 3, rent: [1, 3, 5] },
  red:       { name: 'Lisboa Típica',    hex: '#d62828', text: '#fff', size: 3, rent: [2, 3, 6] },
  yellow:    { name: 'Centro Chique',    hex: '#f6d743', text: '#111', size: 3, rent: [2, 4, 6] },
  green:     { name: 'Linha de Cascais', hex: '#2a9d5c', text: '#fff', size: 3, rent: [2, 4, 7] },
  darkblue:  { name: 'Resorts de Luxo',  hex: '#1d3a8a', text: '#fff', size: 2, rent: [3, 8] },
  railroad:  { name: 'Transportes',      hex: '#2b2b2b', text: '#fff', size: 4, rent: [1, 2, 3, 4] },
  utility:   { name: 'Contadores',       hex: '#9fb8ad', text: '#111', size: 2, rent: [1, 2] },
};
const COLOR_KEYS = Object.keys(COLORS);
const NO_BUILD = ['railroad', 'utility'];

const PROP_VALUE = { brown: 1, lightblue: 1, pink: 2, orange: 2, red: 3, yellow: 3, green: 4, darkblue: 4, railroad: 2, utility: 2 };

const PROPERTIES = {
  brown: [
    ['Cave em Odivelas', 'Janela? Isso é um luxo.'],
    ['Quarto na Amadora', 'Partilhado com 6 estudantes de Erasmus.'],
  ],
  lightblue: [
    ['T1 no Barreiro', 'Vista rio (se esticares bem o pescoço).'],
    ['Garagem no Seixal', 'Agora é um "T0 com charme industrial".'],
    ['Anexo em Almada', 'Já foi um galinheiro. As galinhas foram despejadas.'],
  ],
  pink: [
    ['Arroios', 'A mercearia virou café de especialidade a 5€.'],
    ['Intendente', 'Gentrificado com sucesso. Parabéns a todos.'],
    ['Anjos', 'Nem os anjos conseguem pagar a renda.'],
  ],
  orange: [
    ['Bonfim', 'Quando o Porto descobriu os nómadas digitais.'],
    ['Cedofeita', 'Brunch obrigatório ao domingo.'],
    ['Ribeira', 'Mais tuk-tuks do que moradores.'],
  ],
  red: [
    ['Alfama', 'Fado ao vivo. Vizinhos, já não.'],
    ['Mouraria', 'Em cada porta, um cofre de chaves.'],
    ['Graça', 'A única coisa de graça é o nome.'],
  ],
  yellow: [
    ['Chiado', 'O T0 mais caro da Europa.'],
    ['Príncipe Real', 'Nem os príncipes conseguem lá viver.'],
    ['Bairro Alto', 'Barulho até às 4h incluído na renda.'],
  ],
  green: [
    ['Carcavelos', 'Praia, surf e 3.000€ por mês.'],
    ['Estoril', 'Casino ao lado. Vais precisar.'],
    ['Cascais', 'Onde os vistos gold vão de férias.'],
  ],
  darkblue: [
    ['Comporta', 'Era uma aldeia de pescadores.'],
    ['Quinta do Lago', 'Os pescadores agora são caddies.'],
  ],
  railroad: [
    ['Linha de Sintra', 'Sardinha em lata, versão humana.'],
    ['Cacilheiro', 'A única vista de Lisboa a preço acessível.'],
    ['Metro (quando há)', 'Greve às segundas, quartas e sextas.'],
    ['Autocarro 728', 'Próximo autocarro: 47 min.'],
  ],
  utility: [
    ['Contador da Luz', 'Despesas não incluídas, claro.'],
    ['Contador da Água', 'Água quente é extra.'],
  ],
};

const WILDS = [
  [['darkblue', 'green'], 4],
  [['green', 'railroad'], 4],
  [['utility', 'railroad'], 2],
  [['lightblue', 'railroad'], 4],
  [['lightblue', 'brown'], 1],
  [['pink', 'orange'], 2],
  [['pink', 'orange'], 2],
  [['red', 'yellow'], 3],
  [['red', 'yellow'], 3],
];

const RENT_PAIRS = [
  ['darkblue', 'green'],
  ['red', 'yellow'],
  ['pink', 'orange'],
  ['lightblue', 'brown'],
  ['railroad', 'utility'],
];

const MONEY = {
  1:  [6, 'Trocos do Mealheiro', 'Dá para um café. Em 2015.'],
  2:  [5, 'Subsídio de Férias', 'Férias? Vai direto para a caução.'],
  3:  [3, 'Poupanças de uma Vida', 'Quarenta anos de trabalho.'],
  4:  [3, 'Empréstimo dos Pais', 'A melhor instituição de crédito do país.'],
  5:  [2, 'Bónus de Gestor', 'Por mérito. Claramente.'],
  10: [1, 'Investidor Estrangeiro', 'Pagou a pronto. Nem viu a casa.'],
};

const ACTIONS = {
  dealBreaker:   { icon: '🦅', count: 2,  value: 5, name: 'Fundo Abutre',         desc: 'Rouba um conjunto completo a outro senhorio, com remodelações e tudo.' },
  justSayNo:     { icon: '⚖️', count: 3,  value: 4, name: 'Providência Cautelar', desc: 'Bloqueia uma ação contra ti (ou um bloqueio contra a tua). Os tribunais às vezes funcionam.' },
  slyDeal:       { icon: '🛂', count: 3,  value: 3, name: 'Golden Visa',          desc: 'Fica com uma propriedade de outro jogador (que não esteja num conjunto completo).' },
  forcedDeal:    { icon: '🤝', count: 3,  value: 3, name: 'Permuta Duvidosa',     desc: 'Troca uma propriedade tua por uma de outro jogador (fora de conjuntos completos).' },
  debtCollector: { icon: '📨', count: 3,  value: 3, name: 'Cobrador do Fraque',   desc: 'Um jogador à tua escolha paga-te 5M€.' },
  birthday:      { icon: '🛗', count: 3,  value: 2, name: 'Taxa de Condomínio',   desc: 'Todos os jogadores pagam-te 2M€. Para o elevador que nunca funciona.' },
  passGo:        { icon: '👵', count: 10, value: 1, name: 'Herança da Avó',       desc: 'Compra 2 cartas. Obrigado, avó.' },
  house:         { icon: '🔨', count: 3,  value: 3, name: 'Remodelação Low-Cost', desc: 'Pladur e tinta branca. +3M€ de renda num conjunto completo (exceto Transportes e Contadores).' },
  hotel:         { icon: '🧳', count: 2,  value: 4, name: 'Alojamento Local',     desc: 'Despeja os inquilinos, chama os turistas. +4M€ de renda num conjunto já remodelado.' },
  doubleRent:    { icon: '📈', count: 2,  value: 1, name: 'Atualização da Renda', desc: 'Joga junto com uma Renda para a duplicar. Acima da inflação, claro.' },
};

function buildDeck() {
  let id = 0;
  const deck = [];
  const add = (c) => deck.push({ id: id++, ...c });

  for (const [v, [n, name, desc]] of Object.entries(MONEY)) {
    for (let i = 0; i < n; i++) add({ type: 'money', value: Number(v), name, desc });
  }
  for (const color of COLOR_KEYS) {
    for (const [name, desc] of PROPERTIES[color]) add({ type: 'property', color, value: PROP_VALUE[color], name, desc });
  }
  for (const [colors, value] of WILDS) {
    add({
      type: 'wild', colors, value, name: 'Terreno Ambíguo', icon: '🎭',
      desc: `Conta como ${COLORS[colors[0]].name} ou ${COLORS[colors[1]].name}. Depende de quem pergunta à Câmara.`,
    });
  }
  for (let i = 0; i < 2; i++) {
    add({
      type: 'wild', colors: [...COLOR_KEYS], multi: true, value: 0, name: 'Licença Camarária Mágica', icon: '🪄',
      desc: 'Serve para qualquer cor. Ninguém sabe como foi aprovada. Sem valor monetário.',
    });
  }
  for (const colors of RENT_PAIRS) {
    for (let i = 0; i < 2; i++) {
      add({
        type: 'rent', colors, value: 1, name: 'Renda', icon: '🧾',
        desc: `Todos os jogadores pagam-te a renda de ${COLORS[colors[0]].name} ou ${COLORS[colors[1]].name}.`,
      });
    }
  }
  for (let i = 0; i < 3; i++) {
    add({
      type: 'rent', colors: [...COLOR_KEYS], multi: true, value: 3, name: 'Renda de Mercado', icon: '💸',
      desc: 'Um jogador à tua escolha paga-te a renda de qualquer cor. O mercado regula-se sozinho.',
    });
  }
  for (const [action, def] of Object.entries(ACTIONS)) {
    for (let i = 0; i < def.count; i++) add({ type: 'action', action, value: def.value, name: def.name, desc: def.desc, icon: def.icon });
  }
  return deck;
}
