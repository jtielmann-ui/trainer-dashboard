const https = require('https');

const PODIO_CLIENT_ID = process.env.PODIO_CLIENT_ID || 'class-trainer-payroll-tracker';
const PODIO_CLIENT_SECRET = process.env.PODIO_CLIENT_SECRET || 'Mqi9SBNB9RJSxU2niY5vdplO5Sr4oxpX5LuI4LWsi9aPK3rhY1M7PiVWLs37Eynx';
const TRAINER_APP_ID = '30676083';
const CLASS_APP_ID = '24013170';

function makeRequest(method, hostname, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Node.js'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(data)
          });
        } catch {
          resolve({
            status: res.statusCode,
            data
          });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getPodioToken() {
  const auth = Buffer.from(`${PODIO_CLIENT_ID}:${PODIO_CLIENT_SECRET}`).toString('base64');
  
  const options = {
    hostname: 'api.podio.com',
    path: '/oauth/token',
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + auth
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (res.statusCode === 200) {
            resolve(response.access_token);
          } else {
            reject(new Error('Failed to get Podio token: ' + res.statusCode));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write('grant_type=client_credentials');
    req.end();
  });
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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const token = await getPodioToken();

    // Fetch trainers
    const trainerOptions = {
      hostname: 'api.podio.com',
      path: `/app/${TRAINER_APP_ID}/filter?sort_by=created_on&sort_desc=1`,
      method: 'GET',
      headers: {
        'Authorization': `OAuth2 ${token}`,
        'User-Agent': 'Node.js'
      }
    };

    const trainerData = await new Promise((resolve, reject) => {
      const req = https.request(trainerOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.end();
    });

    const trainer = trainerData.items?.find(item => {
      const emailField = item.fields?.find(f => f.field_id === 276279806);
      return emailField?.values?.[0]?.value === email;
    });

    if (!trainer) {
      return res.status(401).json({ error: 'Trainer email not found' });
    }

    const nameField = trainer.fields?.find(f => f.field_id === 276275551);
    const name = nameField?.values?.[0]?.value || email;

    // Fetch classes
    const classOptions = {
      hostname: 'api.podio.com',
      path: `/app/${CLASS_APP_ID}/filter?sort_by=created_on&sort_desc=1`,
      method: 'GET',
      headers: {
        'Authorization': `OAuth2 ${token}`,
        'User-Agent': 'Node.js'
      }
    };

    const classesData = await new Promise((resolve, reject) => {
      const req = https.request(classOptions, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });
      req.on('error', reject);
      req.end();
    });
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const filteredClasses = classesData.items
      ?.filter(item => {
        const datesField = item.fields?.find(f => f.field_id === 201834925);
        const trainersField = item.fields?.find(f => f.field_id === 232176709);
        
        if (!datesField || !trainersField) return false;

        const dateRange = datesField.values?.[0];
        const startDate = new Date(dateRange?.start);
        
        if (startDate < thirtyDaysAgo) return false;

        const trainerValues = trainersField.values || [];
        return trainerValues.some(tv => tv.value?.item_id === trainer.item_id);
      })
      .map(item => {
        const datesField = item.fields?.find(f => f.field_id === 201834925);
        const classNameField = item.fields?.find(f => f.field_id === 202573663);
        const payrollField = item.fields?.find(f => f.field_id === 278105426);

        const dateRange = datesField?.values?.[0];
        const startDate = new Date(dateRange?.start);
        const endDate = dateRange?.end ? new Date(dateRange.end) : startDate;
        const payrollDate = calculatePayrollDate(startDate);
        
        const payrollValue = payrollField?.values?.[0]?.text || payrollField?.values?.[0]?.value || '';
        const isPaid = payrollValue === 'Paid';

        return {
          className: classNameField?.values?.[0]?.value || 'Class',
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          payrollDate: payrollDate.toISOString(),
          isPaid
        };
      })
      .sort((a, b) => new Date(b.startDate) - new Date(a.startDate));

    res.status(200).json({
      success: true,
      trainerName: name,
      classes: filteredClasses
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message || 'An error occurred' });
  }
};
}
