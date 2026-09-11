const https = require('https');

const PODIO_CLIENT_ID = process.env.PODIO_CLIENT_ID || 'class-trainer-payroll-tracker';
const PODIO_CLIENT_SECRET = process.env.PODIO_CLIENT_SECRET || 'Mqi9SBNB9RJSxU2niY5vdplO5Sr4oxpX5LuI4LWsi9aPK3rhY1M7PiVWLs37Eynx';

function makeRequest(options, body) {
  return new Promise(function(resolve, reject) {
    var req = https.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
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

function getPodioToken() {
  var auth = Buffer.from(PODIO_CLIENT_ID + ':' + PODIO_CLIENT_SECRET).toString('base64');
  return makeRequest({
    hostname: 'api.podio.com',
    path: '/oauth/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + auth
    }
  }, 'grant_type=client_credentials').then(function(response) {
    return response.data.access_token;
  });
}

function calculatePayrollDate(classDate) {
  var basePayroll = new Date(2026, 8, 16);
  var classDateObj = new Date(classDate);
  var payrollDate = new Date(basePayroll);
  while (payrollDate < classDateObj) {
    payrollDate.setDate(payrollDate.getDate() + 14);
  }
  return payrollDate;
}

module.exports = function(req, res) {
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

  var name = req.body.email;
  if (!name) {
    res.status(400).json({ error: 'Name required' });
    return;
  }

  getPodioToken().then(function(token) {
    return makeRequest({
      hostname: 'api.podio.com',
      path: '/app/30676083/filter?sort_by=created_on&sort_desc=1',
      method: 'GET',
      headers: { 'Authorization': 'OAuth2 ' + token }
    }).then(function(contactResponse) {
      if (!contactResponse.data || !contactResponse.data.items || contactResponse.data.items.length === 0) {
        throw new Error('No contacts found');
      }

      var contact = contactResponse.data.items.find(function(item) {
        if (!item.fields) return false;
        var nameField = item.fields.find(function(f) { return f.field_id === 276275551; });
        if (!nameField || !nameField.values || !nameField.values[0]) return false;
        return nameField.values[0].value === name;
      });

      if (!contact) {
        throw new Error('Name not found');
      }

      return { token: token, contact: contact, name: name };
    });
  }).then(function(data) {
    return makeRequest({
      hostname: 'api.podio.com',
      path: '/app/26863984/filter?sort_by=created_on&sort_desc=1',
      method: 'GET',
      headers: { 'Authorization': 'OAuth2 ' + data.token }
    }).then(function(staffResponse) {
      if (!staffResponse.data || !staffResponse.data.items || staffResponse.data.items.length === 0) {
        throw new Error('No staff found');
      }

      var staff = staffResponse.data.items.find(function(item) {
        if (!item.fields) return false;
        var contactField = item.fields.find(function(f) { return f.field_id === 276281378; });
        if (!contactField || !contactField.values || !contactField.values[0]) return false;
        if (!contactField.values[0].value) return false;
        return contactField.values[0].value.item_id === data.contact.item_id;
      });

      if (!staff) {
        throw new Error('Staff not found');
      }

      return { token: data.token, staffId: staff.item_id, name: data.name };
    });
  }).then(function(data) {
    return makeRequest({
      hostname: 'api.podio.com',
      path: '/app/24013170/filter?sort_by=created_on&sort_desc=1',
      method: 'GET',
      headers: { 'Authorization': 'OAuth2 ' + data.token }
    }).then(function(classResponse) {
      if (!classResponse.data || !classResponse.data.items) {
        res.status(200).json({ success: true, trainerName: data.name, classes: [] });
        return;
      }

      var thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      var classes = classResponse.data.items.filter(function(item) {
        if (!item.fields) return false;
        var datesField = item.fields.find(function(f) { return f.field_id === 201834925; });
        var trainersField = item.fields.find(function(f) { return f.field_id === 232176709; });
        if (!datesField || !datesField.values || !datesField.values[0]) return false;
        if (!trainersField || !trainersField.values) return false;
        var startDate = new Date(datesField.values[0].start);
        if (startDate < thirtyDaysAgo) return false;
        return trainersField.values.some(function(tv) { return tv.value && tv.value.item_id === data.staffId; });
      }).map(function(item) {
        var datesField = item.fields.find(function(f) { return f.field_id === 201834925; });
        var classNameField = item.fields.find(function(f) { return f.field_id === 202573663; });
        var payrollField = item.fields.find(function(f) { return f.field_id === 278105426; });
        
        var dateRange = datesField.values[0];
        var startDate = new Date(dateRange.start);
        var endDate = dateRange.end ? new Date(dateRange.end) : startDate;
        var payrollDate = calculatePayrollDate(startDate);
        var payrollValue = (payrollField && payrollField.values && payrollField.values[0]) ? (payrollField.values[0].text || payrollField.values[0].value || '') : '';

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

      res.status(200).json({ success: true, trainerName: data.name, classes: classes });
    });
  }).catch(function(error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  });
};
