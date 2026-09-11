const https = require('https');

const STAFF_APP_TOKEN = '30b2589559090efd1a6eaf887d8e2af5';
const CONTACT_APP_TOKEN = 'b1401a14d195dbc8115dd2ae9775bd29';
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

module.exports = function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  Promise.all([
    makeRequest({
      hostname: 'api.podio.com',
      path: '/app/26863984/filter',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + STAFF_APP_TOKEN
      }
    }, JSON.stringify({})),
    makeRequest({
      hostname: 'api.podio.com',
      path: '/app/30676083/filter',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + CONTACT_APP_TOKEN
      }
    }, JSON.stringify({})),
    makeRequest({
      hostname: 'api.podio.com',
      path: '/app/24013170/filter',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + EVENTS_APP_TOKEN
      }
    }, JSON.stringify({}))
  ]).then(function(responses) {
    var staffData = responses[0].data;
    var contactData = responses[1].data;
    var eventsData = responses[2].data;

    console.log('Staff items:', staffData.items ? staffData.items.length : 0);
    console.log('Contact items:', contactData.items ? contactData.items.length : 0);
    console.log('Events items:', eventsData.items ? eventsData.items.length : 0);

    var contactMap = {};
    if (contactData.items) {
      contactData.items.forEach(function(item) {
        var nameField = item.fields.find(function(f) { return f.field_id === 276275551; });
        if (nameField && nameField.values && nameField.values[0]) {
          contactMap[item.item_id] = nameField.values[0].value;
        }
      });
    }
    console.log('Contact map:', Object.keys(contactMap).length);

    var staffMap = {};
    if (staffData.items) {
      staffData.items.forEach(function(item) {
        var contactField = item.fields.find(function(f) { return f.field_id === 276281378; });
        if (contactField && contactField.values && contactField.values[0] && contactField.values[0].value) {
          var contactId = contactField.values[0].value.item_id;
          staffMap[item.item_id] = contactMap[contactId] || 'Unknown';
        }
      });
    }
    console.log('Staff map:', Object.keys(staffMap).length);

    var trainerClasses = {};
    var thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    if (eventsData.items) {
      eventsData.items.forEach(function(item) {
        var datesField = item.fields.find(function(f) { return f.field_id === 201834925; });
        var trainersField = item.fields.find(function(f) { return f.field_id === 232176709; });
        var classNameField = item.fields.find(function(f) { return f.field_id === 202573663; });
        var payrollField = item.fields.find(function(f) { return f.field_id === 278105426; });

        if (!datesField || !datesField.values) return;

        var startDate = new Date(datesField.values[0].start);
        if (startDate < thirtyDaysAgo) return;

        var className = classNameField && classNameField.values && classNameField.values[0] ? classNameField.values[0].value : 'Class';
        var endDate = datesField.values[0].end ? new Date(datesField.values[0].end) : startDate;
        var payrollValue = payrollField && payrollField.values && payrollField.values[0] ? (payrollField.values[0].text || payrollField.values[0].value || '') : 'Pending';

        if (trainersField && trainersField.values) {
          trainersField.values.forEach(function(tv) {
            if (tv.value) {
              var staffId = tv.value.item_id;
              var trainerName = staffMap[staffId] || 'Unknown';
              
              if (!trainerClasses[trainerName]) {
                trainerClasses[trainerName] = [];
              }
              
              trainerClasses[trainerName].push({
                className: className,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                payrollValue: payrollValue,
                isPaid: payrollValue === 'Paid'
              });
            }
          });
        }
      });
    }

    console.log('Final trainers:', Object.keys(trainerClasses).length);

    res.status(200).json({ success: true, trainerClasses: trainerClasses, debug: { staff: staffData.items ? staffData.items.length : 0, contacts: contactData.items ? contactData.items.length : 0, events: eventsData.items ? eventsData.items.length : 0 } });
  }).catch(function(error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  });
};
