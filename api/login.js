const https = require('https');

const CONTACT_APP_TOKEN = 'b1401a14d195dbc8115dd2ae9775bd29';
const STAFF_APP_TOKEN = '30b2589559090efd1a6eaf887d8e2af5';
const EVENTS_APP_TOKEN = '99095231209a438aa37611d28271a273';

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

  makeRequest({
    hostname: 'api.podio.com',
    path: '/app/30676083/filter?app_token=' + CONTACT_APP_TOKEN,
    method: 'GET'
  }).then(function(contactResponse) {
    console.log('Contact response status:', contactResponse.status);
    
    if (!contactResponse.data || !contactResponse.data.items) {
      throw new Error('No contacts found');
    }

    var contact = null;
    for (var i = 0; i < contactResponse.data.items.length; i++) {
      var item = contactResponse.data.items[i];
      if (!item.fields) continue;
      for (var j = 0; j < item.fields.length; j++) {
        var field = item.fields[j];
        if (field.field_id === 276275551 && field.values && field.values[0]) {
          if (field.values[0].value === name) {
            contact = item;
            break;
          }
        }
      }
      if (contact) break;
    }

    if (!contact) {
      throw new Error('Contact not found');
    }

    return contact;
  }).then(function(contact) {
    return makeRequest({
      hostname: 'api.podio.com',
      path: '/app/26863984/filter?app_token=' + STAFF_APP_TOKEN,
      method: 'GET'
    }).then(function(staffResponse) {
      if (!staffResponse.data || !staffResponse.data.items) {
        throw new Error('No staff found');
      }

      var staff = null;
      for (var i = 0; i < staffResponse.data.items.length; i++) {
        var item = staffResponse.data.items[i];
        if (!item.fields) continue;
        for (var j = 0; j < item.fields.length; j++) {
          var field = item.fields[j];
          if (field.field_id === 276281378 && field.values && field.values[0]) {
            if (field.values[0].value && field.values[0].value.item_id === contact.item_id) {
              staff = item;
              break;
            }
          }
        }
        if (staff) break;
      }

      if (!staff) {
        throw new Error('Staff not found');
      }

      return { staffId: staff.item_id, contactName: name };
    });
  }).then(function(staffData) {
    return makeRequest({
      hostname: 'api.podio.com',
      path: '/app/24013170/filter?app_token=' + EVENTS_APP_TOKEN,
      method: 'GET'
    }).then(function(classResponse) {
      if (!classResponse.data || !classResponse.data.items) {
        res.status(200).json({ success: true, trainerName: staffData.contactName, classes: [] });
        return;
      }

      var thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      var classes = [];
      for (var i = 0; i < classResponse.data.items.length; i++) {
        var item = classResponse.data.items[i];
        if (!item.fields) continue;

        var datesField = null;
        var trainersField = null;
        var classNameField = null;
        var payrollField = null;

        for (var j = 0; j < item.fields.length; j++) {
          var field = item.fields[j];
          if (field.field_id === 201834925) datesField = field;
          if (field.field_id === 232176709) trainersField = field;
          if (field.field_id === 202573663) classNameField = field;
          if (field.field_id === 278105426) payrollField = field;
        }

        if (!datesField || !datesField.values) continue;
        if (!trainersField || !trainersField.values) continue;

        var startDate = new Date(datesField.values[0].start);
        if (startDate < thirtyDaysAgo) continue;

        var trainerMatch = false;
        for (var k = 0; k < trainersField.values.length; k++) {
          if (trainersField.values[k].value && trainersField.values[k].value.item_id === staffData.staffId) {
            trainerMatch = true;
            break;
          }
        }

        if (!trainerMatch) continue;

        var endDate = datesField.values[0].end ? new Date(datesField.values[0].end) : startDate;
        var payrollDate = calculatePayrollDate(startDate);
        var payrollValue = payrollField && payrollField.values && payrollField.values[0] ? (payrollField.values[0].text || payrollField.values[0].value || '') : '';

        var className = classNameField && classNameField.values && classNameField.values[0] ? classNameField.values[0].value : 'Class';

        classes.push({
          className: className,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          payrollDate: payrollDate.toISOString(),
          isPaid: payrollValue === 'Paid'
        });
      }

      classes.sort(function(a, b) {
        return new Date(b.startDate) - new Date(a.startDate);
      });

      res.status(200).json({ success: true, trainerName: staffData.contactName, classes: classes });
    });
  }).catch(function(error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  });
};
