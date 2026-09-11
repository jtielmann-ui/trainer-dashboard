const fetch = require('node-fetch');

const PODIO_CLIENT_ID = process.env.PODIO_CLIENT_ID || 'class-trainer-payroll-tracker';
const PODIO_CLIENT_SECRET = process.env.PODIO_CLIENT_SECRET || 'Mqi9SBNB9RJSxU2niY5vdplO5Sr4oxpX5LuI4LWsi9aPK3rhY1M7PiVWLs37Eynx';
const TRAINER_APP_ID = '30676083';
const CLASS_APP_ID = '24013170';

async function getPodioToken() {
  const response = await fetch('https://api.podio.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${PODIO_CLIENT_ID}:${PODIO_CLIENT_SECRET}`).toString('base64')
    },
    body: 'grant_type=client_credentials'
  });

  if (!response.ok) {
    throw new Error('Failed to get Podio token');
  }

  const data = await response.json();
  return data.access_token;
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

export default async function handler(req, res) {
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

    const trainerResponse = await fetch(
      `https://api.podio.com/app/${TRAINER_APP_ID}/filter?sort_by=created_on&sort_desc=1`,
      {
        headers: { 'Authorization': `OAuth2 ${token}` }
      }
    );

    if (!trainerResponse.ok) {
      throw new Error('Failed to fetch trainers');
    }

    const trainersData = await trainerResponse.json();
    const trainer = trainersData.items?.find(item => {
      const emailField = item.fields?.find(f => f.field_id === 276279806);
      return emailField?.values?.[0]?.value === email;
    });

    if (!trainer) {
      return res.status(401).json({ error: 'Trainer email not found' });
    }

    const nameField = trainer.fields?.find(f => f.field_id === 276275551);
    const name = nameField?.values?.[0]?.value || email;

    const classesResponse = await fetch(
      `https://api.podio.com/app/${CLASS_APP_ID}/filter?sort_by=created_on&sort_desc=1`,
      {
        headers: { 'Authorization': `OAuth2 ${token}` }
      }
    );

    if (!classesResponse.ok) {
      throw new Error('Failed to fetch classes');
    }

    const classesData = await classesResponse.json();
    
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
}
