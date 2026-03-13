export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Email invalide' });
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'api-key': process.env.BREVO_API_KEY
      },
      body: JSON.stringify({
        email,
        listIds: [3],
        updateEnabled: true,
        attributes: {
          SOURCE: 'beverified.fr',
          DATE_INSCRIPTION: new Date().toISOString().split('T')[0]
        }
      })
    });

    const status = response.status;

    if (status === 201 || status === 204) {
      return res.status(200).json({ success: true });
    } else if (status === 400) {
      const data = await response.json();
      if (data.code === 'duplicate_parameter') {
        return res.status(200).json({ success: true, duplicate: true });
      }
      return res.status(400).json({ error: data.message });
    } else {
      return res.status(500).json({ error: 'Erreur Brevo' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
