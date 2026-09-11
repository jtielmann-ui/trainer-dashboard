const https = require('https');

function makeRequest(hostname, path, method, headers, body) {
  return new Promise(function(resolve, reject) {
    var options = {
      hostname: hostname,
      path: path,
      method: method,
      headers: headers
    };
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

function getPodioAccessToken() {
  var body = new URLSearchParams({
    grant_type: 'app',
    app_id: process.env.PODIO_APP_ID || '24013170',
    app_token: process.env.PODIO_APP_TOKEN || '99095231209a438aa37611d28271a273',
    client_id: process.env.PODIO_CLIENT_ID || 'class-trainer-payroll-tracker',
    client_secret: process.env.PODIO_CLIENT_SECRET || 'Mqi9SBNB9RJSxU2niY5vdplO5Sr4oxpX5LuI4LWsi9aPK3rhY1M7PiVWLs37Eynx'
  }).toString();

  return makeRequest('podio.com', '/oauth/token', 'POST', {
    'Content-Type': 'application/x-www-form-urlencoded'
  }, body).then(function(response) {
    if (response.status !== 200) {
      throw new Error('Failed to get Podio token: ' + response.status);
    }
    return response.data.access_token;
  });
}

function getPodioItem(token, itemId) {
  return makeRequest('api.podio.com', '/item/' + itemId, 'GET', {
    'Authorization': 'OAuth2 ' + token
  }).then(function(response) {
    if (response.status === 200) {
      return response.data;
    }
    return null;
  });
}

function getClassTypeName(token, classItemId) {
  return getPodioItem(token, classItemId).then(function(item) {
    if (!item || !item.fields) return null;
    var nameField = item.fields.find(function(f) { return f.field_id === 247305074; });
    if (nameField && nameField.values && nameField.values[0]) {
      return nameField.values[0].value;
    }
    return null;
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  var token;
  var contactMap = {};
  var staffMap = {};

  getPodioAccessToken().then(function(accessToken) {
    token = accessToken;
    console.log('Got Podio token successfully');

    return Promise.all([
      makeRequest('api.podio.com', '/item/app/26863984/filter/', 'POST', {
        'Content-Type': 'application/json',
        'Authorization': 'OAuth2 ' + token
      }, JSON.stringify({})),
      makeRequest('api.podio.com', '/item/app/30676083/filter/', 'POST', {
        'Content-Type': 'application/json',
        'Authorization': 'OAuth2 ' + token
      }, JSON.stringify({})),
      makeRequest('api.podio.com', '/item/app/24013170/filter/', 'POST', {
        'Content-Type': 'application/json',
        'Authorization': 'OAuth2 ' + token
      }, JSON.stringify({}))
    ]);
  }).then(function(responses) {
    var staffData = responses[0].data;
    var contactData = responses[1].data;
    var eventsData = responses[2].data;

    console.log('Staff items:', staffData.items ? staffData.items.length : 0);
    console.log('Contact items:', contactData.items ? contactData.items.length : 0);
    console.log('Events items (before filtering):', eventsData.items ? eventsData.items.length : 0);

    if (contactData.items) {
      contactData.items.forEach(function(item) {
        var nameField = item.fields.find(function(f) { return f.field_id === 276275551; });
        if (nameField && nameField.values && nameField.values[0]) {
          contactMap[item.item_id] = nameField.values[0].value;
        }
      });
    }

    if (staffData.items) {
      staffData.items.forEach(function(item) {
        var contactField = item.fields.find(function(f) { return f.field_id === 276281378; });
        if (contactField && contactField.values && contactField.values[0] && contactField.values[0].value) {
          var contactId = contactField.values[0].value.item_id;
          staffMap[item.item_id] = contactMap[contactId] || 'Unknown';
        }
      });
    }

    var today = new Date();
    today.setHours(0, 0, 0, 0);

    var eventsToProcess = [];
    if (eventsData.items) {
      eventsData.items.forEach(function(item) {
        var datesField = item.fields.find(function(f) { return f.field_id === 201834925; });
        var statusField = item.fields.find(function(f) { return f.field_id === 215214960; });
        var classTypeField = item.fields.find(function(f) { return f.field_id === 247306182; });

        if (!datesField || !datesField.values) return;

        var startDate = new Date(datesField.values[0].start);
        startDate.setHours(0, 0, 0, 0);

        if (startDate >= today) return;

        var statusText = null;
        if (statusField && statusField.values && statusField.values[0]) {
          statusText = statusField.values[0].value || statusField.values[0].text;
        }
        if (!statusText || (statusText !== 'Private Client' && statusText !== 'Open')) return;

        var classTypeItemId = null;
        if (classTypeField && classTypeField.values && classTypeField.values[0] && classTypeField.values[0].value) {
          classTypeItemId = classTypeField.values[0].value.item_id;
        }

        if (classTypeItemId) {
          eventsToProcess.push({ item: item });
        }
      });
    }

    return Promise.all(eventsToProcess.map(function(e) {
      var classTypeItemId = e.item.fields.find(function(f) { return f.field_id === 247306182; }).values[0].value.item_id;
      return getClassTypeName(token, classTypeItemId).then(function(name) {
        return { item: e.item, classTypeName: name };
      });
    }));
  }).then(function(processedEvents) {
    var trainerClasses = {};

    processedEvents.forEach(function(e) {
      if (e.classTypeName === 'Event') return;

      var item = e.item;
      var datesField = item.fields.find(function(f) { return f.field_id === 201834925; });
      var trainersField = item.fields.find(function(f) { return f.field_id === 232176709; });
      var classNameField = item.fields.find(function(f) { return f.field_id === 202573663; });
      var payrollField = item.fields.find(function(f) { return f.field_id === 278105426; });

      var className = classNameField && classNameField.values && classNameField.values[0] ? classNameField.values[0].value : 'Class';
      var startDate = new Date(datesField.values[0].start);
      var endDate = datesField.values[0].end ? new Date(datesField.values[0].end) : startDate;
      var payrollDate = calculatePayrollDate(startDate);
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
              payrollDate: payrollDate.toISOString(),
              isPaid: payrollValue === 'Paid'
            });
          }
        });
      }
    });

    console.log('Final trainers:', Object.keys(trainerClasses).length);

    res.status(200).json({ success: true, trainerClasses: trainerClasses });
  }).catch(function(error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  });
};
