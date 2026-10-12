// Senhorio — arranque

$('#start-btn').onclick = () => {
  const name = $('#player-name').value.trim() || 'Senhorio Novato';
  UI.start(name, Number($('#opp-count').value));
};

$('#end-turn').onclick = () => UI.endTurn();

$('#rules-btn').onclick = () => {
  if (!$('#modal').hidden) return;
  UI.modal((box, close) => {
    box.append($('#rules-tpl').content.cloneNode(true));
    const ok = h('button', 'btn primary', 'Percebi');
    ok.onclick = () => close();
    box.append(ok);
  });
};
