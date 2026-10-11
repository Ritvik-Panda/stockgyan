
const enquiryForm = document.getElementById('enquiryForm');

if (enquiryForm) {
  enquiryForm.addEventListener('submit', async function (event) {
    event.preventDefault();

    const messageBox = document.getElementById('enquiryMsg');
    const submitButton = enquiryForm.querySelector('button[type="submit"]');

    const payload = {
      name: document.getElementById('enquiryName').value.trim(),
      phone: document.getElementById('enquiryPhone').value.trim(),
      enquiry_type: document.getElementById('enquiryType').value,
      message: ''
    };

    messageBox.textContent = 'Submitting your enquiry…';
    messageBox.className = 'form-message';
    submitButton.disabled = true;

    try {
      const response = await fetch('/api/enquiry', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await response.json();

      if (!response.ok || data.ok !== true) {
        throw new Error(data.error || 'Unable to submit your enquiry.');
      }

      messageBox.textContent = 'Thank you! Your enquiry has been submitted successfully.';
      messageBox.className = 'form-message is-visible success';
      enquiryForm.reset();

    } catch (error) {
      messageBox.textContent = error.message || 'Submission failed. Please try again.';
      messageBox.className = 'form-message is-visible error';
    } finally {
      submitButton.disabled = false;
    }
  });
}
