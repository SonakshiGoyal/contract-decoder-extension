// popup.js
document.getElementById("processBtn").addEventListener("click", () => {
  const text = document.getElementById("textInput").value;
  if (!text) {
    alert("Please enter some text.");
    return;
  }
  // For now, just echo text back
  document.getElementById("result").innerText = "You entered:\n\n" + text;
});
