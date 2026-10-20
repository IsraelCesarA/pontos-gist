'use strict';

// ============================================================
// CONFIGURAÇÃO DO MAPA
// ============================================================

// Inicializa o mapa após o DOM estar carregado
document.addEventListener('DOMContentLoaded', function () {
  const map = L.map('map').setView([-3.7317, -38.5267], 13);

  const layerGroup = L.layerGroup().addTo(map);

  let sondaMarker = null;
  let isSondaActive = false;
  let fixedSondaMarker = null;
  let fixedSondaCircle = null;

  let gistMarkerSet = false;
  let validadorMarkerSet = false;

  // IMPORTANTE:
  // O GitHub Pages utiliza HTTPS. Por isso, a página consulta
  // o proxy HTTPS da Vercel, que acessa a API HTTP da ETUFOR.
  //
  // O proxy precisa estar publicado e operacional.
  const API_URL = 'https://api-transporte-rose.vercel.app/api/postoControle/';

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

  atualizarStatus('Mapa carregado. Pronto para uso!', 'success');

  // ============================================================
  // MENSAGENS DE STATUS
  // ============================================================

  function atualizarStatus(mensagem, tipo = 'info') {
    const elemento = document.getElementById('status');
    if (elemento) {
      elemento.textContent = mensagem;
      elemento.dataset.tipo = tipo;
    }
    console.log(`[${tipo.toUpperCase()}] ${mensagem}`);
  }

  // ============================================================
  // FUNÇÕES AUXILIARES
  // ============================================================

  function obterValor(objeto, chaves) {
    for (const chave of chaves) {
      const valor = objeto?.[chave];
      if (valor !== undefined && valor !== null && String(valor).trim() !== '') {
        return valor;
      }
    }
    return undefined;
  }

  function converterNumero(valor) {
    if (typeof valor === 'string') {
      valor = valor.trim().replace(',', '.');
    }
    if (valor === undefined || valor === null || valor === '') return NaN;
    return Number(valor);
  }

  function temCoordenadas(objeto) {
    if (!objeto || typeof objeto !== 'object') return false;
    const lat = obterValor(objeto, ['latitude', 'lat', 'Latitude', 'LATITUDE']);
    const lng = obterValor(objeto, ['longitude', 'lng', 'lon', 'Longitude', 'LONGITUDE']);
    return lat !== undefined && lng !== undefined;
  }

  function identificarNumeroPosto(objeto) {
    return obterValor(objeto, [
      'numeroPosto', 'numero_posto', 'numero', 'posto',
      'codigoPosto', 'codigo_posto', 'codigo', 'idPosto', 'id_posto'
    ]);
  }

  function extrairPosto(resposta, numeroDigitado) {
    let posto = resposta;
    for (let i = 0; i < 5; i++) {
      if (!posto || typeof posto !== 'object') {
        throw new Error('A resposta da API não contém um posto válido.');
      }
      if (Array.isArray(posto)) {
        if (posto.length === 1) {
          posto = posto[0];
          continue;
        }
        const encontrado = posto.find(item => {
          const identificador = identificarNumeroPosto(item);
          return identificador !== undefined && String(identificador).trim() === numeroDigitado;
        });
        if (encontrado) {
          posto = encontrado;
          continue;
        }
        throw new Error(`A API retornou uma lista, mas não encontrei o posto ${numeroDigitado}.`);
      }
      if (temCoordenadas(posto)) break;
      const chave = ['data', 'resultado', 'result', 'posto'].find(
        nome => posto[nome] !== undefined && posto[nome] !== null && typeof posto[nome] === 'object'
      );
      if (!chave) break;
      posto = posto[chave];
    }
    if (!posto || typeof posto !== 'object' || Array.isArray(posto)) {
      throw new Error('Não foi possível interpretar o posto retornado.');
    }
    const latitude = converterNumero(obterValor(posto, ['latitude', 'lat', 'Latitude', 'LATITUDE']));
    const longitude = converterNumero(obterValor(posto, ['longitude', 'lng', 'lon', 'Longitude', 'LONGITUDE']));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
        latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      console.error('[ETUFOR] Resposta inválida:', resposta);
      throw new Error('A resposta não possui latitude e longitude válidas.');
    }
    const identificador = identificarNumeroPosto(posto);
    if (identificador !== undefined && typeof identificador !== 'object' &&
        String(identificador).trim() !== numeroDigitado) {
      console.error('[ETUFOR] Solicitado:', numeroDigitado, 'Recebido:', identificador);
      throw new Error(`Solicitado ${numeroDigitado}, API retornou ${identificador}. Ponto não desenhado.`);
    }
    const nome = obterValor(posto, ['nome', 'name', 'descricao', 'descrição', 'nomePosto', 'local']);
    const raioOriginal = obterValor(posto, ['raio', 'radius', 'raioMetros', 'raio_metros']);
    const raioConvertido = converterNumero(raioOriginal);
    return {
      ...posto,
      latitude,
      longitude,
      nome: nome !== undefined ? String(nome) : `Posto ${numeroDigitado}`,
      raio: Number.isFinite(raioConvertido) && raioConvertido >= 0 ? raioConvertido : 0
    };
  }

  // ============================================================
  // CONSULTA À API
  // ============================================================

  async function fetchPosto(numero) {
    const numeroPosto = String(numero).trim();
    if (!/^\d+$/.test(numeroPosto)) {
      throw new Error('Digite um número de posto válido.');
    }
    // ✅ Correção: garante barra única entre base e número
    const url = API_URL.replace(/\/$/, '') + '/' + encodeURIComponent(numeroPosto);
    console.log('-----------------------------------------');
    console.log('[ETUFOR] Número:', numeroPosto);
    console.log('[ETUFOR] URL:', url);
    atualizarStatus(`Consultando o posto ${numeroPosto}...`, 'info');
    let resposta;
    try {
      resposta = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'omit'
      });
    } catch (erro) {
      console.error('[ETUFOR] Erro de conexão:', erro);
      throw new Error('Falha ao conectar à API. Verifique a conexão e o proxy da Vercel.');
    }
    const texto = await resposta.text();
    console.log('[ETUFOR] Status:', resposta.status);
    console.log('[ETUFOR] Resposta:', texto.slice(0, 200));
    if (!resposta.ok) {
      throw new Error(`Servidor retornou HTTP ${resposta.status}: ${texto.slice(0, 150)}`);
    }
    let dados;
    try {
      dados = JSON.parse(texto);
    } catch {
      throw new Error('O servidor não retornou JSON válido.');
    }
    return extrairPosto(dados, numeroPosto);
  }

  // ============================================================
  // DESENHO DOS MARCADORES E RAIOS
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
    if (coordEl) coordEl.textContent = `Lat: ${info.lat?.toFixed(6) || '—'} | Lng: ${info.lng?.toFixed(6) || '—'}`;
  }

  function desenharRaio(lat, lng, nome, raioApi, raioEntrada, raioSaida, type) {
    lat = converterNumero(lat);
    lng = converterNumero(lng);
    raioApi = converterNumero(raioApi);
    raioEntrada = converterNumero(raioEntrada) || 100;
    raioSaida = converterNumero(raioSaida) || 200;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      alert('Coordenadas inválidas.');
      return;
    }
    raioApi = Number.isFinite(raioApi) && raioApi >= 0 ? raioApi : 0;
    // Remove camadas anteriores do mesmo tipo
    layerGroup.eachLayer(l => {
      if (l.options?.type === type) layerGroup.removeLayer(l);
    });
    if (type === 'gist') gistMarkerSet = true;
    else if (type === 'validador') validadorMarkerSet = true;
    const isValidador = type === 'validador';
    const color = isValidador ? '#16803d' : '#1769d2';
    const iconUrl = 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
      `<path fill="${color}" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>` +
      `<circle cx="12" cy="9" r="2.5" fill="white"/></svg>`
    );
    const icon = L.icon({
      iconUrl,
      iconSize: [24, 24],
      iconAnchor: [12, 24],
      popupAnchor: [0, -24]
    });
    const marcador = L.marker([lat, lng], { icon, type }).addTo(layerGroup);
    marcador.bindPopup(`<strong>${escapeHTML(nome)}</strong><br>Lat: ${lat.toFixed(6)}<br>Lng: ${lng.toFixed(6)}`);
    if (type === 'gist' && raioApi > 0) {
      L.circle([lat, lng], {
        color: '#3f83f8', fillColor: '#3f83f8', fillOpacity: 0.25,
        radius: raioApi, weight: 2, dashArray: '5, 5', type
      }).addTo(layerGroup).bindPopup(`Raio API: ${raioApi} m`);
    }
    L.circle([lat, lng], {
      color: '#ef4444', fillColor: '#f87171', fillOpacity: 0.2,
      radius: raioEntrada, weight: 2, type
    }).addTo(layerGroup).bindPopup(`Raio Entrada: ${raioEntrada} m`);
    L.circle([lat, lng], {
      color: '#facc15', fillColor: '#facc15', fillOpacity: 0.15,
      radius: raioSaida, weight: 2, type
    }).addTo(layerGroup).bindPopup(`Raio Saída: ${raioSaida} m`);
    map.setView([lat, lng], 16);
    updateInfoPanel({ name: nome, raioApi, raioEntrada, raioSaida, lat, lng });
    atualizarStatus(`${nome}: exibido em ${lat.toFixed(6)}, ${lng.toFixed(6)}`, 'success');
  }

  // ============================================================
  // BUSCA DE POSTO
  // ============================================================

  async function buscarPosto() {
    const numero = document.getElementById('postoInput').value.trim();
    const raioEntrada = converterNumero(document.getElementById('raioEntrada').value) || 100;
    const raioSaida = converterNumero(document.getElementById('raioSaida').value) || 200;
    if (!numero) { alert('Digite o número do posto.'); return; }
    const botao = document.getElementById('btnBuscarPosto');
    if (botao) botao.disabled = true;
    try {
      const data = await fetchPosto(numero);
      desenharRaio(data.latitude, data.longitude, data.nome, data.raio, raioEntrada, raioSaida, 'gist');
    } catch (erro) {
      console.error('[POSTO] Erro:', erro);
      atualizarStatus(`Falha: ${erro.message}`, 'error');
      alert(`Não foi possível consultar o posto ${numero}:\n\n${erro.message}`);
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
    if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
        lat < -90 || lat > 90 || lng < -180 || lng > 180) {
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
    sondaMarker = L.marker([0, 0], { icon, interactive: false, keyboard: false }).addTo(map);
    sondaMarker.setOpacity(0);
  }

  function handleMouseMove(e) {
    if (!isSondaActive || !sondaMarker) return;
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    sondaMarker.setLatLng([lat, lng]).setOpacity(1);
    document.getElementById('sondaLat').textContent = lat.toFixed(6);
    document.getElementById('sondaLng').textContent = lng.toFixed(6);
  }

  function toggleSonda() {
    if (!sondaMarker) return;
    isSondaActive = !isSondaActive;
    const button = document.getElementById('toggleSonda');
    if (isSondaActive) {
      button.textContent = 'Desativar Sonda';
      button.classList.add('button-primary');
      button.classList.remove('button-secondary');
      map.on('mousemove', handleMouseMove);
      document.getElementById('sondaLat').textContent = 'Mova sobre o mapa...';
      document.getElementById('sondaLng').textContent = 'Mova sobre o mapa...';
      if (fixedSondaMarker) sondaMarker.setOpacity(0);
    } else {
      button.textContent = 'Ativar Sonda';
      button.classList.add('button-secondary');
      button.classList.remove('button-primary');
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
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    const raioInformado = converterNumero(document.getElementById('raioSonda').value);
    const raioSonda = Number.isFinite(raioInformado) && raioSonda >= 0 ? raioInformado : 50;
    // Remove anteriores
    if (fixedSondaMarker) map.removeLayer(fixedSondaMarker);
    if (fixedSondaCircle) map.removeLayer(fixedSondaCircle);
    // Ícone fixo (roxo)
    const icon = L.divIcon({
      className: 'sonda-marker-container',
      html: '<span class="sonda-marker" style="background-color:#8A2BE2;border-width:3px;"></span>',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });
    fixedSondaMarker = L.marker([lat, lng], { icon }).addTo(map);
    fixedSondaMarker.bindPopup(`Sonda fixa<br>Lat: ${lat.toFixed(6)}<br>Lng: ${lng.toFixed(6)}`);
    // Círculo do raio
    fixedSondaCircle = L.circle([lat, lng], {
      color: '#8a2be2', fillColor: '#8a2be2', fillOpacity: 0.15,
      radius: raioSonda, weight: 2
    }).addTo(map).bindPopup(`Raio da sonda: ${raioSonda} m`);
    // Atualiza exibição
    document.getElementById('sondaLat').textContent = lat.toFixed(6);
    document.getElementById('sondaLng').textContent = lng.toFixed(6);
    if (sondaMarker) sondaMarker.setOpacity(0);
    atualizarStatus(`Sonda fixada em ${lat.toFixed(6)}, ${lng.toFixed(6)}`, 'success');
  });

  // Clicar no mapa também pega coordenadas
  map.on('click', e => {
    document.getElementById('latInput').value = e.latlng.lat.toFixed(6);
    document.getElementById('lngInput').value = e.latlng.lng.toFixed(6);
  });

  // ✅ Inicializa tudo
  initializeSondaMarker();
});
