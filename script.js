
'use strict';

// ============================================================
// CONFIGURAÇÃO DO MAPA
// ============================================================

const map = L.map('map').setView([-3.7678, -38.5365], 12);

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
const API_URL =
    'https://api-transporte-rose.vercel.app/api/postoControle/';

// ============================================================
// CAMADA DO MAPA
// ============================================================

L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    {
        attribution:
            '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 19
    }
).addTo(map);

// ============================================================
// MENSAGENS DE STATUS
// O elemento #status é opcional no HTML.
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
// FUNÇÕES AUXILIARES PARA LER A RESPOSTA DA API
// ============================================================

function obterValor(objeto, chaves) {
    for (const chave of chaves) {
        const valor = objeto?.[chave];

        if (
            valor !== undefined &&
            valor !== null &&
            String(valor).trim() !== ''
        ) {
            return valor;
        }
    }

    return undefined;
}

function converterNumero(valor) {
    if (typeof valor === 'string') {
        valor = valor.trim().replace(',', '.');
    }

    if (valor === undefined || valor === null || valor === '') {
        return NaN;
    }

    return Number(valor);
}

function temCoordenadas(objeto) {
    if (!objeto || typeof objeto !== 'object') {
        return false;
    }

    const lat = obterValor(objeto, [
        'latitude', 'lat', 'Latitude', 'LATITUDE'
    ]);

    const lng = obterValor(objeto, [
        'longitude', 'lng', 'lon',
        'Longitude', 'LONGITUDE'
    ]);

    return lat !== undefined && lng !== undefined;
}

function identificarNumeroPosto(objeto) {
    return obterValor(objeto, [
        'numeroPosto',
        'numero_posto',
        'numero',
        'posto',
        'codigoPosto',
        'codigo_posto',
        'codigo',
        'idPosto',
        'id_posto'
    ]);
}

function extrairPosto(resposta, numeroDigitado) {
    let posto = resposta;

    // Desembrulha respostas comuns:
    // { data: {...} }, { resultado: {...} }, etc.
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

                return identificador !== undefined &&
                    String(identificador).trim() === numeroDigitado;
            });

            if (encontrado) {
                posto = encontrado;
                continue;
            }

            throw new Error(
                `A API retornou uma lista, mas não foi possível identificar ` +
                `o posto ${numeroDigitado}. Confira a resposta no console.`
            );
        }

        if (temCoordenadas(posto)) {
            break;
        }

        const chave = ['data', 'resultado', 'result', 'posto']
            .find(nome => {
                const valor = posto[nome];

                return valor !== undefined &&
                    valor !== null &&
                    typeof valor === 'object';
            });

        if (!chave) {
            break;
        }

        posto = posto[chave];
    }

    if (!posto || typeof posto !== 'object' || Array.isArray(posto)) {
        throw new Error('Não foi possível interpretar o posto retornado.');
    }

    const latitude = converterNumero(obterValor(posto, [
        'latitude', 'lat', 'Latitude', 'LATITUDE'
    ]));

    const longitude = converterNumero(obterValor(posto, [
        'longitude', 'lng', 'lon',
        'Longitude', 'LONGITUDE'
    ]));

    if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
    ) {
        console.error('[ETUFOR] Estrutura sem coordenadas válidas:', resposta);

        throw new Error(
            'A resposta não possui latitude e longitude válidas. ' +
            'Verifique os campos retornados pela API.'
        );
    }

    // Se a resposta informar o número do posto, verifica se
    // corresponde ao que o usuário digitou.
    const identificador = identificarNumeroPosto(posto);

    if (
        identificador !== undefined &&
        typeof identificador !== 'object' &&
        String(identificador).trim() !== numeroDigitado
    ) {
        console.error('[ETUFOR] Número solicitado:', numeroDigitado);
        console.error('[ETUFOR] Número retornado:', identificador);
        console.error('[ETUFOR] Resposta completa:', resposta);

        throw new Error(
            `Você solicitou o posto ${numeroDigitado}, mas a API informou ` +
            `o identificador ${identificador}. O ponto não será desenhado.`
        );
    }

    const nome = obterValor(posto, [
        'nome', 'name', 'descricao', 'descrição',
        'nomePosto', 'nome_posto', 'local'
    ]);

    const raioOriginal = obterValor(posto, [
        'raio', 'radius', 'raioMetros', 'raio_metros'
    ]);

    const raioConvertido = converterNumero(raioOriginal);

    return {
        ...posto,
        latitude,
        longitude,
        nome: nome !== undefined ? String(nome) : `Posto ${numeroDigitado}`,
        raio: Number.isFinite(raioConvertido) && raioConvertido >= 0
            ? raioConvertido
            : 0
    };
}

// ============================================================
// CONSULTA REAL À API
// Não utiliza coordenadas simuladas quando ocorre um erro.
// ============================================================

async function fetchPosto(numero) {
    const numeroPosto = String(numero).trim();

    if (!/^\d+$/.test(numeroPosto)) {
        throw new Error('Digite um número de posto válido.');
    }

    const url = `${API_URL}${encodeURIComponent(numeroPosto)}`;

    console.log('-----------------------------------------');
    console.log('[ETUFOR] Número digitado:', numeroPosto);
    console.log('[ETUFOR] URL consultada:', url);
    console.log('[ETUFOR] Página atual:', window.location.href);

    atualizarStatus(`Consultando o posto ${numeroPosto}...`, 'info');

    let resposta;

    try {
        resposta = await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/json'
            },
            cache: 'no-store',
            credentials: 'omit'
        });
    } catch (erro) {
        console.error('[ETUFOR] Erro de conexão:', erro);

        throw new Error(
            'Falha ao conectar ao proxy HTTPS. Verifique se a API da ' +
            'Vercel está publicada, se a URL está correta e se o navegador ' +
            'consegue acessar o endpoint.'
        );
    }

    const texto = await resposta.text();

    console.log('[ETUFOR] Status HTTP:', resposta.status);
    console.log('[ETUFOR] Resposta original:', texto);

    if (!resposta.ok) {
        throw new Error(
            `O servidor retornou HTTP ${resposta.status}. ` +
            texto.slice(0, 250)
        );
    }

    let dados;

    try {
        dados = JSON.parse(texto);
    } catch {
        throw new Error(
            'O servidor não retornou JSON válido. Verifique a resposta ' +
            'do proxy da Vercel.'
        );
    }

    const posto = extrairPosto(dados, numeroPosto);

    console.log('[ETUFOR] Posto interpretado:', posto);
    console.log('[ETUFOR] Coordenadas:', {
        latitude: posto.latitude,
        longitude: posto.longitude
    });

    return posto;
}

// ============================================================
// DESENHO DOS MARCADORES E DOS RAIOS
// ============================================================

function desenharRaio(
    lat,
    lng,
    nome,
    raioApi,
    raioEntrada,
    raioSaida,
    type
) {
    lat = converterNumero(lat);
    lng = converterNumero(lng);
    raioApi = converterNumero(raioApi);
    raioEntrada = converterNumero(raioEntrada);
    raioSaida = converterNumero(raioSaida);

    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < -90 || lat > 90 ||
        lng < -180 || lng > 180
    ) {
        alert('As coordenadas do ponto são inválidas.');
        return;
    }

    raioApi = Number.isFinite(raioApi) && raioApi >= 0 ? raioApi : 0;
    raioEntrada =
        Number.isFinite(raioEntrada) && raioEntrada >= 0
            ? raioEntrada : 100;
    raioSaida =
        Number.isFinite(raioSaida) && raioSaida >= 0
            ? raioSaida : 200;

    // Remove os pontos e círculos anteriores somente do mesmo tipo.
    const camadasParaRemover = [];

    layerGroup.eachLayer(layer => {
        if (layer.options && layer.options.type === type) {
            camadasParaRemover.push(layer);
        }
    });

    camadasParaRemover.forEach(layer => {
        layerGroup.removeLayer(layer);
    });

    if (type === 'gist') {
        gistMarkerSet = true;
    } else if (type === 'validador') {
        validadorMarkerSet = true;
    }

    const info = {
        name: nome,
        raioApi,
        raioEntrada,
        raioSaida
    };

    const isValidador = type === 'validador';
    const color = isValidador ? 'green' : 'blue';

    const iconUrl =
        'data:image/svg+xml;charset=UTF-8,' +
        encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" ` +
            `width="24" height="24" viewBox="0 0 24 24">` +
            `<path fill="${color}" d="M12 2C8.13 2 5 5.13 5 9` +
            `c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z` +
            `m0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/>` +
            `</svg>`
        );

    const customIcon = L.icon({
        iconUrl,
        iconSize: [24, 24],
        iconAnchor: [12, 24],
        popupAnchor: [0, -24]
    });

    const marcador = L.marker([lat, lng], {
        icon: customIcon,
        type
    }).addTo(layerGroup);

    marcador.bindPopup(
        `<strong>${escapeHTML(nome)}</strong><br>` +
        `Lat: ${lat.toFixed(6)}<br>` +
        `Lng: ${lng.toFixed(6)}`
    );

    // Raio retornado pela API: azul, somente para GIST.
    if (type === 'gist' && raioApi > 0) {
        L.circle([lat, lng], {
            color: 'blue',
            fillColor: '#3f83f8',
            fillOpacity: 0.3,
            radius: raioApi,
            weight: 2,
            dashArray: '5, 5',
            type
        })
            .addTo(layerGroup)
            .bindPopup(`Raio API: ${raioApi} m`);
    }

    // Raio de entrada: vermelho.
    L.circle([lat, lng], {
        color: 'red',
        fillColor: '#f87171',
        fillOpacity: 0.25,
        radius: raioEntrada,
        weight: 2,
        type
    })
        .addTo(layerGroup)
        .bindPopup(`Raio Entrada: ${raioEntrada} m`);

    // Raio de saída: amarelo/laranja.
    L.circle([lat, lng], {
        color: 'orange',
        fillColor: '#facc15',
        fillOpacity: 0.2,
        radius: raioSaida,
        weight: 2,
        type
    })
        .addTo(layerGroup)
        .bindPopup(`Raio Saída: ${raioSaida} m`);

    map.setView([lat, lng], 16);

    updateInfoPanel(info);

    atualizarStatus(
        `${nome}: ponto exibido em ${lat.toFixed(6)}, ${lng.toFixed(6)}.`,
        'success'
    );
}

// Evita inserir o nome do local como HTML executável no popup.
function escapeHTML(valor) {
    return String(valor).replace(/[&<>"']/g, caractere => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[caractere]);
}

// ============================================================
// PAINEL DE INFORMAÇÕES
// ============================================================

function updateInfoPanel(info) {
    const nomeElemento = document.getElementById('nomePosto');
    const raioElemento = document.getElementById('raioPosto');

    if (nomeElemento) {
        nomeElemento.textContent = info.name;
    }

    if (raioElemento) {
        raioElemento.textContent =
            `API: ${info.raioApi} m | ` +
            `Entrada: ${info.raioEntrada} m | ` +
            `Saída: ${info.raioSaida} m`;
    }

    const coordenadasElemento = document.getElementById('coordPosto');

    if (coordenadasElemento) {
        // O mapa já recebeu as coordenadas válidas.
        coordenadasElemento.textContent = '';
    }
}

// ============================================================
// BUSCA DE POSTO GIST
// ============================================================

async function buscarPosto() {
    const numero = document.getElementById('postoInput').value.trim();

    const raioEntrada =
        converterNumero(document.getElementById('raioEntrada').value) || 100;

    const raioSaida =
        converterNumero(document.getElementById('raioSaida').value) || 200;

    if (!numero) {
        alert('Digite o número do posto de controle.');
        return;
    }

    const botao = document.getElementById('btnBuscarPosto');

    if (botao) {
        botao.disabled = true;
    }

    try {
        const data = await fetchPosto(numero);

        // Somente desenha depois de validar a resposta da API.
        desenharRaio(
            data.latitude,
            data.longitude,
            data.nome,
            data.raio,
            raioEntrada,
            raioSaida,
            'gist'
        );
    } catch (erro) {
        console.error('[POSTO] Erro na busca:', erro);

        atualizarStatus(
            `Falha ao consultar o posto ${numero}: ${erro.message}`,
            'error'
        );

        alert(
            `Não foi possível consultar o posto ${numero}.\n\n` +
            `${erro.message}\n\n` +
            'Abra o console do navegador (F12) para ver os detalhes.'
        );
    } finally {
        if (botao) {
            botao.disabled = false;
        }
    }
}

document.getElementById('btnBuscarPosto')
    .addEventListener('click', buscarPosto);

// Permite pesquisar pressionando Enter.
document.getElementById('postoInput')
    .addEventListener('keydown', evento => {
        if (evento.key === 'Enter') {
            evento.preventDefault();
            buscarPosto();
        }
    });

// ============================================================
// VALIDADORES POR COORDENADAS MANUAIS
// ============================================================

document.getElementById('btnUsarLatLng')
    .addEventListener('click', () => {
        const lat = converterNumero(
            document.getElementById('latInput').value
        );

        const lng = converterNumero(
            document.getElementById('lngInput').value
        );

        const raioEntrada =
            converterNumero(document.getElementById('raioEntrada').value) || 100;

        const raioSaida =
            converterNumero(document.getElementById('raioSaida').value) || 200;

        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng) ||
            lat < -90 || lat > 90 ||
            lng < -180 || lng > 180
        ) {
            alert('Informe latitude e longitude válidas para os validadores.');
            return;
        }

        desenharRaio(
            lat,
            lng,
            'Validadores (Manual)',
            0,
            raioEntrada,
            raioSaida,
            'validador'
        );
    });

// ============================================================
// SONDA MÓVEL
// ============================================================

function initializeSondaMarker() {
    const customIcon = L.divIcon({
        className: 'sonda-marker-container',
        html: '<span class="sonda-marker"></span>',
        iconSize: [15, 15],
        iconAnchor: [7.5, 7.5]
    });

    sondaMarker = L.marker([0, 0], {
        icon: customIcon,
        interactive: false,
        keyboard: false
    }).addTo(map);

    sondaMarker.setOpacity(0);
}

function handleMouseMove(e) {
    if (!isSondaActive || !sondaMarker) {
        return;
    }

    const lat = e.latlng.lat;
    const lng = e.latlng.lng;

    sondaMarker.setLatLng([lat, lng]).setOpacity(1);

    document.getElementById('sondaLat').textContent = lat.toFixed(6);
    document.getElementById('sondaLng').textContent = lng.toFixed(6);
}

function toggleSonda() {
    if (!sondaMarker) {
        return;
    }

    isSondaActive = !isSondaActive;

    const button = document.getElementById('toggleSonda');

    if (isSondaActive) {
        button.textContent = 'Desativar Sonda';
        button.classList.add('btn-primary');
        button.classList.remove('btn-secondary');

        map.on('mousemove', handleMouseMove);

        if (fixedSondaMarker) {
            sondaMarker.setOpacity(0);
        } else {
            sondaMarker.setOpacity(1);
        }

        document.getElementById('sondaLat').textContent = 'Aguardando...';
        document.getElementById('sondaLng').textContent = 'Aguardando...';
    } else {
        button.textContent = 'Ativar Sonda';
        button.classList.add('btn-secondary');
        button.classList.remove('btn-primary');

        map.off('mousemove', handleMouseMove);
        sondaMarker.setOpacity(0);

        if (fixedSondaMarker) {
            const latlng = fixedSondaMarker.getLatLng();

            document.getElementById('sondaLat').textContent =
                latlng.lat.toFixed(6);

            document.getElementById('sondaLng').textContent =
                latlng.lng.toFixed(6);
        } else {
            document.getElementById('sondaLat').textContent = 'Desativada';
            document.getElementById('sondaLng').textContent = 'Desativada';
        }
    }
}

document.getElementById('toggleSonda')
    .addEventListener('click', toggleSonda);

// ============================================================
// FIXAR SONDA COM BOTÃO DIREITO DO MOUSE
// ============================================================

map.on('contextmenu', e => {
    L.DomEvent.preventDefault(e);

    const lat = e.latlng.lat;
    const lng = e.latlng.lng;

    const raioInformado = converterNumero(
        document.getElementById('raioSonda').value
    );

    const raioSonda = Number.isFinite(raioInformado) && raioInformado >= 0
        ? raioInformado
        : 50;

    if (fixedSondaMarker) {
        map.removeLayer(fixedSondaMarker);
        fixedSondaMarker = null;
    }

    if (fixedSondaCircle) {
        map.removeLayer(fixedSondaCircle);
        fixedSondaCircle = null;
    }

    if (sondaMarker) {
        sondaMarker.setOpacity(0);
    }

    const customIcon = L.divIcon({
        className: 'sonda-marker-container fixed-sonda',
        html:
            '<span class="sonda-marker" ' +
            'style="background-color:#8A2BE2;border-color:white;"></span>',
        iconSize: [20, 20],
        iconAnchor: [10, 10]
    });

    fixedSondaMarker = L.m 