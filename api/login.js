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

    // Step 1: Find contact by email
    const contactResponse = await makeRequest({
      hostname: 'api.podio.com',
      path: '/app/30676083/filter?sort_by=created_on&sort_desc=1',
      method: 'GET',
      headers: { 'Authorization': 'OAuth2 ' + token }
    });

    if (!contactResponse.data || !contactResponse.data.items || contactResponse.data.items.length === 0) {
      res.status(401).json({ error: 'No contacts found' });
      return;
    }

    const contact = contactResponse.data.items.find(function(item) {
      if (!item.fields) return false;
      const emailField = item.fields.find(function(f) { return f.field_id === 276974029; });
      if (!emailField || !emailField.values || !emailField.values[0]) return false;
      return emailField.values[0].value === email;
    });

    if (!contact) {
      res.status(401).json({ error: 'Email not found in contacts' });
      return;
    }

    const contactName = contact.fields.find(function(f) { return f.field_id === 276275551; });
    const name = (contactName && contactName.values && contactName.values[0]) ? contactName.values[0].value : email;
    const contactItemId = contact.item_id;

    // Step 2: Find staff that references this contact
    const staffResponse = await makeRequest({
      hostname: 'api.podio.com',
      path: '/app/26863984/filter?sort_by=created_on&sort_desc=1',
      method: 'GET',
      headers: { 'Authorization': 'OAuth2 ' + token }
    });

    if (!staffResponse.data || !staffResponse.data.items || staffResponse.data.items.length === 0) {
      res.status(401).json({ error: 'No staff found' });
      return;
    }

    const staff = staffResponse.data.items.find(function(item) {
      if (!item.fields) return false;
      const contactField = item.fields.find(function(f) { return f.field_id === 276281378; });
      if (!contactField || !contactField.values || !contactField.values[0]) return false;
      if (!contactField.values[0].value) return false;
      return contactField.values[0].value.item_id === contactItemId;
    });

    if (!staff) {
      res.status(401).json({ error: 'Staff record not found for this contact' });
      return;
    }

    const staffItemId = staff.item_id;

    // Step 3: Find events that reference this staff
    const classResponse = await makeRequest({
      hostname: 'api.podio.com',
      path: '/app/24013170/filter?sort_by=created_on&sort_desc=1',
      method: 'GET',
      headers: { 'Authorization': 'OAuth2 ' + token }
    });

    if (!classResponse.data || !classResponse.data.items) {
      res.status(200).json({ success: true, trainerName: name, classes: [] });
      return;
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const classes = classResponse.data.items.filter(function(item) {
      if (!item.fields) return false;
      const datesField = item.fields.find(function(f) { return f.field_id === 201834925; });
      const trainersField = item.fields.find(function(f) { return f.field_id === 232176709; });
      if (!datesField || !datesField.values || !datesField.values[0]) return false;
      if (!trainersField || !trainersField.values) return false;
      const startDate = new Date(datesField.values[0].start);
      if (startDate < thirtyDaysAgo) return false;
      return trainersField.values.some(function(tv) { return tv.value && tv.value.item_id === staffItemId; });
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
};
