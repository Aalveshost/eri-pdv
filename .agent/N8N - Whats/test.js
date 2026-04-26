const axios = require('axios');

const SERVER_URL = 'http://localhost:3001/extract-boleto';
const TEST_URL = 'https://www.bling.com.br/doc.view.php?id=00ef120f12e7cbeff3f4c093121ab0b1a2f2ec18bfa017cd4307c18e54401039';

async function runTest() {
  console.log('Testando endpoint /extract-boleto...');
  console.log('URL do boleto:', TEST_URL);
  console.log('---');

  try {
    const response = await axios.post(SERVER_URL, { url: TEST_URL }, { timeout: 60000 });
    console.log('Resultado:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (err) {
    if (err.response) {
      console.error('Erro da API:', JSON.stringify(err.response.data, null, 2));
    } else {
      console.error('Erro:', err.message);
    }
  }
}

runTest();
