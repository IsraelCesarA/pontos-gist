'use strict';

// ============================================================
// CONFIGURAÇÃO DO MAPA
// ============================================================

document.addEventListener('DOMContentLoaded', function () {
  const map = L.map('map').setView([-3.7317, -38.5267], 13);

  const layerGroup = L.layerGroup().addTo(map);
  let listaPostos = []; // ← Todos os postos carregados da API

  let sondaMarker = null;
  let isSondaActive = false;
  let fixedSondaMarker = null;
  let fixedSondaCircle = null;

  let gistMarkerSet = false;
  let validadorMarkerSet = false;

  // ✅ API OFICIAL DA ETUFOR
  const API_URL = 'https://gistapis.etufor.ce.gov.br:8081/api/postoControle';

  // ============================================================
  // CAMADA DO MAPA
  // ============================================================

  L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }
  ).addTo(map);

  // ============================================================
  // FUNÇÕES AUXILIARES
  // ============================================================

  function atualizarStatus(mensagem, tipo = 'info') {
    const elemento = document.getElementById('status');
    if (elemento) {
      elemento.textContent = mensagem;
      elemento.dataset.tipo = tipo;
    }
    console.log(`[${tipo.toUpperCase()}] ${mensagem}`);
  }

  function converterNumero(valor) {
    if (typeof valor === 'string') valor = valor.trim().replace(',', '.');
    if (valor === undefined || valor === null || valor === '') return NaN;
    return Number(valor);
  }

  // ✅ PARSE DO XML → Array de objetos
  function parseXML(xmlText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    const itens = xmlDoc.getElementsByTagName('postoControle');
    const postos = [];

    for (let i = 0; i < itens.length; i++) {
      const getItem = (tag) => itens[i].getElementsByTagName(tag)[1]?.textContent?.trim() ||
                              itens[i].getElementsByTagName(tag)[0]?.textContent?.trim();
      
      postos.push({
        numero: getItem('numero'),
        nome: getItem('nome'),
        nomeFantasia: getItem('nomeFantasia') || '',
        latitude: converterNumero(getItem('latitude')),
        longitude: converterNumero(getItem('longitude')),
        raio: converterNumero(getItem('raio'))
      });
    }
    return postos;
  }

  // ============================================================
  // CARREGAR TODOS OS POSTOS DA API
  // ============================================================

  async function carregarTodosPostos() {
    atualizarStatus('🔄 Carregando lista de postos...', 'info');
    try {
      const resposta = await fetch(API_URL, {
        method: 'GET',
        headers: { 'Accept': 'application/xml, text/xml, */*' },
        cache: 'no-store'
      });

      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      
      const textoXML = await resposta.text();
      listaPostos = parseXML(textoXML);
      
      atualizarStatus(`✅ ${listaPostos.length} postos carregados com sucesso!`, 'success');
      console.log(`[ETUFOR] ${listaPostos.length} postos carregados`);
    } catch (erro) {
      console.error('[ETUFOR] Falha na API:', erro);
      atualizarStatus(`⚠️ Não foi possível carregar a API: ${erro.message}`, 'error');
      alert(`Atenção: Não foi possível conectar à API da ETUFOR.\n\nDetalhe: ${erro.message}\n\nVerifique sua conexão ou tente novamente mais tarde.`);
    }
  }

  // ============================================================
  // BUSCAR POSTO NA LISTA LOCAL
  // ============================================================

  function buscarPostoLocalmente(numero) {
    const numeroBusca = String(numero).trim();
    return listaPostos.find(p => p.numero === numeroBusca);
  }

  // ============================================================
  // DESENHO DOS MARCADORES
  // ============================================================

  function escapeHTML(valor) {
    return String(valor).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function updateInfoPanel(info) {
    const nomeEl = document.getElementById('nomePosto');
    const raioEl = document.getElementById('raioPosto');
    const coordEl = document.getElementById('coordPosto');
    if (nomeEl) nomeEl.textContent = info.name;
    if (raioEl) raioEl.textContent = `API: ${info.raioApi} m | Entrada: ${info.raioEntrada} m | Saída: ${info.raioSaida} m`;
    if (coordEl && info.lat && info.lng) {
      coordEl.textContent = `Lat: ${info.lat.toFixed(6)} | Lng: ${info.lng.toFixed(6)}`;
    }
  }

  function desenharRaio(lat, lng, nome, raioApi, raioEntrada, raioSaida, type) {
    lat = converterNumero(lat);
    lng = converterNumero(lng);
    raioEntrada = converterNumero(raioEntrada) || 100;
    raioSaida = converterNumero(raioSaida) || 200;
    raioApi = Number.isFinite(raioApi) && raioApi >= 0 ? raioApi : 0;

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      alert('Coordenadas inválidas.');
      return;
    }

    layerGroup.eachLayer(l => { if (l.options?.type === type) layerGroup.removeLayer(l); });
    if (type === 'gist') gistMarkerSet = true;
    else if (type === 'validador') validadorMarkerSet = true;

    const isValidador = type === 'validador';
    const cor = isValidador ? '#16803d' : '#1769d2';
    const iconUrl = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
      `<path fill="${cor}" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>` +
      `<circle cx="12" cy="9" r="2.5" fill="white"/></svg>`
    );
    const icon = L.icon({ iconUrl, iconSize: [24, 24], iconAnchor: [12, 24] });

    L.marker([lat, lng], { icon, type }).addTo(layerGroup)
      .bindPopup(`<strong>${escapeHTML(nome)}</strong><br>Lat: ${lat.toFixed(6)}<br>Lng: ${lng.toFixed(6)}`);

    if (type === 'gist' && raioApi > 0) {
      L.circle([lat, lng], { color: '#3f83f8', fillColor: '#3f83f8', fillOpacity: 0.25, radius: raioApi, weight: 2, dashArray: '5,5', type }).addTo(layerGroup);
    }
    L.circle([lat, lng], { color: '#ef4444', fillColor: '#f87171', fillOpacity: 0.2, radius: raioEntrada, weight: 2, type }).addTo(layerGroup);
    L.circle([lat, lng], { color: '#facc15', fillColor: '#facc15', fillOpacity: 0.15, radius: raioSaida, weight: 2, type }).addTo(layerGroup);

    map.setView([lat, lng], 16);
    updateInfoPanel({ name: nome, raioApi, raioEntrada, raioSaida, lat, lng });
    atualizarStatus(`✅ ${nome} — exibido no mapa`, 'success');
  }

  // ============================================================
  // BUSCA DE POSTO
  // ============================================================

  async function buscarPosto() {
    const numero = document.getElementById('postoInput').value.trim();
    const raioEntrada = converterNumero(document.getElementById('raioEntrada').value) || 100;
    const raioSaida = converterNumero(document.getElementById('raioSaida').value) || 200;

    if (!numero) { alert('Digite o número do posto.'); return; }
    if (listaPostos.length === 0) {
      atualizarStatus('⏳ Carregando lista... tente novamente em instantes', 'info');
      return;
    }

    const botao = document.getElementById('btnBuscarPosto');
    if (botao) botao.disabled = true;

    try {
      const posto = buscarPostoLocalmente(numero);
      if (!posto) {
        throw new Error(`Posto ${numero} não encontrado.\n\nVerifique o número digitado.`);
      }
      const nomeCompleto = posto.nomeFantasia 
        ? `${posto.nomeFantasia} — ${posto.nome}` 
        : posto.nome;
      
      desenharRaio(posto.latitude, posto.longitude, nomeCompleto, posto.raio, raioEntrada, raioSaida, 'gist');
    } catch (erro) {
      console.error('[ERRO]', erro);
      atualizarStatus(`❌ ${erro.message}`, 'error');
      alert(erro.message);
    } finally {
      if (botao) botao.disabled = false;
    }
  }

  document.getElementById('btnBuscarPosto').addEventListener('click', buscarPosto);
  document.getElementById('postoInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); buscarPosto(); }
  });

  // ============================================================
  // VALIDADORES MANUAIS
  // ============================================================

  document.getElementById('btnUsarLatLng').addEventListener('click', () => {
    const lat = converterNumero(document.getElementById('latInput').value);
    const lng = converterNumero(document.getElementById('lngInput').value);
    const raioEntrada = converterNumero(document.getElementById('raioEntrada').value) || 100;
    const raioSaida = converterNumero(document.getElementById('raioSaida').value) || 200;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      alert('Informe latitude e longitude válidas.');
      return;
    }
    desenharRaio(lat, lng, 'Validador (Manual)', 0, raioEntrada, raioSaida, 'validador');
  });

  // ============================================================
  // SONDA MÓVEL
  // ============================================================

  function initializeSondaMarker() {
    const icon = L.divIcon({
      className: 'sonda-marker-container',
      html: '<span class="sonda-marker"></span>',
      iconSize: [15, 15],
      iconAnchor: [7.5, 7.5]
    });
    sondaMarker = L.marker([0, 0], { icon, interactive: false }).addTo(map);
    sondaMarker.setOpacity(0);
  }

  function handleMouseMove(e) {
    if (!isSondaActive || !sondaMarker) return;
    sondaMarker.setLatLng([e.latlng.lat, e.latlng.lng]).setOpacity(1);
    document.getElementById('sondaLat').textContent = e.latlng.lat.toFixed(6);
    document.getElementById('sondaLng').textContent = e.latlng.lng.toFixed(6);
  }

  function toggleSonda() {
    if (!sondaMarker) return;
    isSondaActive = !isSondaActive;
    const btn = document.getElementById('toggleSonda');
    if (isSondaActive) {
      btn.textContent = 'Desativar Sonda';
      btn.classList.add('button-primary');
      btn.classList.remove('button-secondary');
      map.on('mousemove', handleMouseMove);
      document.getElementById('sondaLat').textContent = 'Mova sobre o mapa...';
      document.getElementById('sondaLng').textContent = 'Mova sobre o mapa...';
      if (fixedSondaMarker) sondaMarker.setOpacity(0);
    } else {
      btn.textContent = 'Ativar Sonda';
      btn.classList.add('button-secondary');
      btn.classList.remove('button-primary');
      map.off('mousemove', handleMouseMove);
      sondaMarker.setOpacity(0);
      if (fixedSondaMarker) {
        const ll = fixedSondaMarker.getLatLng();
        document.getElementById('sondaLat').textContent = ll.lat.toFixed(6);
        document.getElementById('sondaLng').textContent = ll.lng.toFixed(6);
      } else {
        document.getElementById('sondaLat').textContent = 'Desativada';
        document.getElementById('sondaLng').textContent = 'Desativada';
      }
    }
  }

  document.getElementById('toggleSonda').addEventListener('click', toggleSonda);

  // ============================================================
  // FIXAR SONDA COM BOTÃO DIREITO
  // ============================================================

  map.on('contextmenu', e => {
    L.DomEvent.preventDefault(e);
    if (!isSondaActive) return;
    const { lat, lng } = e.latlng;
    const raio = converterNumero(document.getElementById('raioSonda').value) || 50;
    if (fixedSondaMarker) map.removeLayer(fixedSondaMarker);
    if (fixedSondaCircle) map.removeLayer(fixedSondaCircle);

    const icon = L.divIcon({
      className: 'sonda-marker-container',
      html: '<span class="sonda-marker" style="background-color:#8A2BE2;border-width:3px;"></span>',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });
    fixedSondaMarker = L.marker([lat, lng], { icon }).addTo(map);
    fixedSondaMarker.bindPopup(`📍 Sonda fixa<br>Lat: ${lat.toFixed(6)}<br>Lng: ${lng.toFixed(6)}`);
    fixedSondaCircle = L.circle([lat, lng], {
      color: '#8a2be2', fillColor: '#8a2be2', fillOpacity: 0.15, radius: raio, weight: 2
    }).addTo(map).bindPopup(`Raio: ${raio} m`);

    document.getElementById('sondaLat').textContent = lat.toFixed(6);
    document.getElementById('sondaLng').textContent = lng.toFixed(6);
    if (sondaMarker) sondaMarker.setOpacity(0);
    atualizarStatus(`📍 Sonda fixada — ${lat.toFixed(6)}, ${lng.toFixed(6)}`, 'success');
  });

  // Clique no mapa preenche coordenadas
  map.on('click', e => {
    document.getElementById('latInput').value = e.latlng.lat.toFixed(6);
    document.getElementById('lngInput').value = e.latlng.lng.toFixed(6);
  });

  // ✅ INICIALIZAÇÃO
  initializeSondaMarker();
  carregarTodosPostos(); // ← Carrega a lista ao iniciar
});
