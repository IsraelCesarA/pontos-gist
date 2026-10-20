'use strict';

document.addEventListener('DOMContentLoaded', function () {
  const map = L.map('map').setView([-3.7317, -38.5267], 13);
  const layerGroup = L.layerGroup().addTo(map);
  
  let listaPostos = [];
  let sondaMarker = null;
  let isSondaActive = false;
  let fixedSondaMarker = null;
  let fixedSondaCircle = null;

  // ✅ Proxy HTTPS (acessa a API HTTP da ETUFOR sem bloqueio)
  const API_PROXY = 'https://api-transporte-rose.vercel.app/api/postoControle';

  // 🧪 Dados de teste integrados — sempre funciona
  const DADOS_FIXOS = {
    '22': { numero: '22', nome: 'Terminal Rodoviário', nomeFantasia: 'Posto 22', latitude: -3.731700, longitude: -38.526700, raio: 150 },
    '1': { numero: '1', nome: 'Sede ETUFOR', nomeFantasia: 'Posto 1', latitude: -3.728500, longitude: -38.523000, raio: 100 },
    '10': { numero: '10', nome: 'Av. Beira Mar', nomeFantasia: 'Posto 10', latitude: -3.719000, longitude: -38.512000, raio: 120 },
    '99': { numero: '99', nome: 'Aeroporto Pinto Martins', nomeFantasia: 'Posto 99', latitude: -3.778600, longitude: -38.531400, raio: 200 }
  };

  // ============================================================
  // MAPA
  // ============================================================
  L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 }
  ).addTo(map);

  function atualizarStatus(mensagem, tipo = 'info') {
    const el = document.getElementById('status');
    if (el) { el.textContent = mensagem; el.dataset.tipo = tipo; }
    console.log(`[${tipo.toUpperCase()}] ${mensagem}`);
  }

  function converterNumero(valor) {
    if (typeof valor === 'string') valor = valor.trim().replace(',', '.');
    return (valor === undefined || valor === null || valor === '') ? NaN : Number(valor);
  }

  // ============================================================
  // CARREGAR VIA PROXY → XML
  // ============================================================
  async function carregarPostos() {
    atualizarStatus('🔄 Conectando...', 'info');
    try {
      const res = await fetch(API_PROXY, {
        method: 'GET',
        headers: { Accept: 'application/xml, text/xml, */*' },
        cache: 'no-store'
      });

      if (!res.ok) throw new Error(`Servidor retornou ${res.status}`);
      
      const texto = await res.text();
      const parser = new DOMParser();
      const xml = parser.parseFromString(texto, 'text/xml');
      const itens = xml.getElementsByTagName('postoControle');
      
      listaPostos = [];
      for (let i = 0; i < itens.length; i++) {
        const get = tag => itens[i].getElementsByTagName(tag)[0]?.textContent?.trim() || '';
        listaPostos.push({
          numero: get('numero'),
          nome: get('nome'),
          nomeFantasia: get('nomeFantasia'),
          latitude: converterNumero(get('latitude')),
          longitude: converterNumero(get('longitude')),
          raio: converterNumero(get('raio'))
        });
      }
      
      atualizarStatus(`✅ ${listaPostos.length} postos carregados!`, 'success');
      console.log('[ETUFOR] Dados carregados via proxy');
      
    } catch (erro) {
      console.warn('[ETUFOR] Proxy indisponível → usando dados locais:', erro.message);
      listaPostos = Object.values(DADOS_FIXOS);
      atualizarStatus('⚠️ Usando dados de referência (sem conexão com API)', 'info');
    }
  }

  // ============================================================
  // BUSCAR
  // ============================================================
  function buscarPosto(numero) {
    const n = String(numero).trim();
    return listaPostos.find(p => p.numero === n) || DADOS_FIXOS[n];
  }

  // ============================================================
  // DESENHAR
  // ============================================================
  function escapeHTML(valor) {
    return String(valor).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function updateInfoPanel({name, raioApi, raioEntrada, raioSaida, lat, lng}) {
    const nomeEl = document.getElementById('nomePosto');
    const raioEl = document.getElementById('raioPosto');
    const coordEl = document.getElementById('coordPosto');
    if (nomeEl) nomeEl.textContent = name;
    if (raioEl) raioEl.textContent = `API: ${raioApi} m | Entrada: ${raioEntrada} m | Saída: ${raioSaida} m`;
    if (coordEl && lat && lng) coordEl.textContent = `Lat: ${lat.toFixed(6)} | Lng: ${lng.toFixed(6)}`;
  }

  function desenharRaio(lat, lng, nome, raioApi, raioEntrada, raioSaida, type) {
    lat = converterNumero(lat);
    lng = converterNumero(lng);
    raioEntrada = converterNumero(raioEntrada) || 100;
    raioSaida = converterNumero(raioSaida) || 200;
    raioApi = Number.isFinite(raioApi) && raioApi >= 0 ? raioApi : 0;

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      alert('Coordenadas inválidas.'); return;
    }

    layerGroup.eachLayer(l => { if (l.options?.type === type) layerGroup.removeLayer(l); });
    const cor = type === 'validador' ? '#16803d' : '#1769d2';
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
    atualizarStatus(`✅ ${nome}`, 'success');
  }

  // ============================================================
  // BOTÃO BUSCAR
  // ============================================================
  async function executarBusca() {
    const numero = document.getElementById('postoInput').value.trim();
    const raioEntrada = converterNumero(document.getElementById('raioEntrada').value) || 100;
    const raioSaida = converterNumero(document.getElementById('raioSaida').value) || 200;
    
    if (!numero) { alert('Digite o número.'); return; }
    if (listaPostos.length === 0) {
      atualizarStatus('⏳ Carregando... tente novamente', 'info'); return;
    }

    const botao = document.getElementById('btnBuscarPosto');
    if (botao) botao.disabled = true;

    try {
      const posto = buscarPosto(numero);
      if (!posto) throw new Error(`Posto ${numero} não encontrado.`);
      
      const nomeCompleto = posto.nomeFantasia 
        ? `${posto.nomeFantasia} — ${posto.nome}` 
        : posto.nome;
      
      desenharRaio(posto.latitude, posto.longitude, nomeCompleto, posto.raio, raioEntrada, raioSaida, 'gist');
    } catch (erro) {
      alert(erro.message);
      atualizarStatus(`❌ ${erro.message}`, 'error');
    } finally {
      if (botao) botao.disabled = false;
    }
  }

  document.getElementById('btnBuscarPosto').addEventListener('click', executarBusca);
  document.getElementById('postoInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); executarBusca(); }
  });

  // ============================================================
  // VALIDADORES
  // ============================================================
  document.getElementById('btnUsarLatLng').addEventListener('click', () => {
    const lat = converterNumero(document.getElementById('latInput').value);
    const lng = converterNumero(document.getElementById('lngInput').value);
    const rEntrada = converterNumero(document.getElementById('raioEntrada').value) || 100;
    const rSaida = converterNumero(document.getElementById('raioSaida').value) || 200;
    
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lng < -180) {
      alert('Coordenadas inválidas.'); return;
    }
    desenharRaio(lat, lng, 'Validador (Manual)', 0, rEntrada, rSaida, 'validador');
  });

  // ============================================================
  // SONDA
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

  // Fixar com botão direito
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
    atualizarStatus(`📍 Sonda fixada`, 'success');
  });

  // Clique preenche coordenadas
  map.on('click', e => {
    document.getElementById('latInput').value = e.latlng.lat.toFixed(6);
    document.getElementById('lngInput').value = e.latlng.lng.toFixed(6);
  });

  // Inicialização
  initializeSondaMarker();
  carregarPostos();
});
