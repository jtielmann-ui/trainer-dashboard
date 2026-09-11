const https = require('https');

const PODIO_CLIENT_ID = process.env.PODIO_CLIENT_ID || 'class-trainer-payroll-tracker';
const PODIO_CLIENT_SECRET = process.env.PODIO_CLIENT_SECRET || 'Mqi9SBNB9RJSxU2niY5vdplO5Sr4oxpX5LuI4LWsi9aPK3rhY1M7PiVWLs37Eynx';

function makeRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getPodioToken() {
  const auth = Buffer.from(PODIO_CLIENT_ID + ':' + PODIO_CLIENT_SECRET).toString('base64');
  const response = await makeRequest({
    hostname: 'api.podio.com',
    path: '/oauth/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + auth
    }
  }, 'grant_type=client_credentials');
  return response.data.access_token;
}

function calculatePayrollDate(classDate) {
  const basePayroll = new Date(2026, 8, 16);
  const classDateObj = new Date(classDate);
  let payrollDate = new Date(basePayroll);
  while (payrollDate < classDateObj) {
    payrollDate.setDate(payrollDate.getDate() + 14);
  }
  return payrollDate;
}

module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const email = req.body.email;
    if (!email) {
      res.status(400).json({ error: 'Email required' });
      return;
    }

    const token = await getPodioToken();

    const trainerResponse = await makeRequest({
      hostname: 'api.podio.com',
      path: '/app/30676083/filter?sort_by=created_on&sort_desc=1',
      method: 'GET',
      headers: { 'Authorization': 'OAuth2 ' + token }
    });

    const trainer = trainerResponse.data.items.find(function(item) {
      const emailField = item.fields.find(function(f) { return f.field_id === 276974029; });
      return emailField && emailField.values && emailField.values[0] && emailField.values[0].value === email;
    });

    if (!trainer) {
      res.status(401).json({ error: 'Trainer not found' });
      return;
    }

    const nameField = trainer.fields.find(function(f) { return f.field_id === 276275551; });
    const name = (nameField && nameField.values && nameField.values[0]) ? nameField.values[0].value : email;

    const classResponse = await makeRequest({
      hostname: 'api.podio.com',
      path: '/app/24013170/filter?sort_by=created_on&sort_desc=1',
      method: 'GET',
      headers: { 'Authorization': 'OAuth2 ' + token }
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const classes = classResponse.data.items.filter(function(item) {
      const datesField = item.fields.find(function(f) { return f.field_id === 201834925; });
      const trainersField = item.fields.find(function(f) { return f.field_id === 232176709; });
      if (!datesField || !trainersField) return false;
      const startDate = new Date(datesField.values[0].start);
      if (startDate < thirtyDaysAgo) return false;
      return trainersField.values.some(function(tv) { return tv.value && tv.value.item_id === trainer.item_id; });
    }).map(function(item) {
      const datesField = item.fields.find(function(f) { return f.field_id === 201834925; });
      const classNameField = item.fields.find(function(f) { return f.field_id === 202573663; });
      const payrollField = item.fields.find(function(f) { return f.field_id === 278105426; });
      
      const dateRange = datesField.values[0];
      const startDate = new Date(dateRange.start);
      const endDate = dateRange.end ? new Date(dateRange.end) : startDate;
      const payrollDate = calculatePayrollDate(startDate);
      const payrollValue = (payrollField && payrollField.values && payrollField.values[0]) ? (payrollField.values[0].text || payrollField.values[0].value || '') : '';

      return {
        className: (classNameField && classNameField.values && classNameField.values[0]) ? classNameField.values[0].value : 'Class',
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        payrollDate: payrollDate.toISOString(),
        isPaid: payrollValue === 'Paid'
      };
    }).sort(function(a, b) {
      return new Date(b.startDate) - new Date(a.startDate);
    });

    res.status(200).json({ success: true, trainerName: name, classes: classes });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
};
