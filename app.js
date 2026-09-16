import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut,
  setPersistence,
  browserSessionPersistence 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  getFirestore, collection, addDoc, onSnapshot, doc, 
  updateDoc, deleteDoc, serverTimestamp, query, where 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCylij3qw5NEVQ1xogHwwq43Wt4r_MagxI",
  authDomain: "veloboard-4f4f7.firebaseapp.com",
  projectId: "veloboard-4f4f7",
  storageBucket: "veloboard-4f4f7.firebasestorage.app",
  messagingSenderId: "1016472638266",
  appId: "1:1016472638266:web:7bea2b735851180cc4b603"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

setPersistence(auth, browserSessionPersistence).catch((err) => {
  console.error("Persistence error:", err);
});

let currentUser = null;
let projectsCache = [];
let tasksCache = [];
let selectedProjectId = null;
let miniDonutChartInstance = null;
let statusChartInstance = null;
let priorityChartInstance = null;
let unsubscribeProjects = null;
let unsubscribeTasks = null;

const authScreen = document.getElementById("auth-screen");
const appContainer = document.getElementById("app-container");
const authError = document.getElementById("auth-error");

// AUTHENTICATION
document.getElementById("login-btn").addEventListener("click", async () => {
  const email = document.getElementById("auth-email").value;
  const pass = document.getElementById("auth-password").value;
  try {
    authError.innerText = "";
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) { authError.innerText = err.message; }
});

document.getElementById("signup-btn").addEventListener("click", async () => {
  const email = document.getElementById("auth-email").value;
  const pass = document.getElementById("auth-password").value;
  try {
    authError.innerText = "";
    await createUserWithEmailAndPassword(auth, email, pass);
  } catch (err) { authError.innerText = err.message; }
});

document.getElementById("logout-btn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    authScreen.style.display = "none";
    appContainer.style.display = "flex";
    document.getElementById("user-email-display").innerText = user.email;
    document.getElementById("user-avatar").innerText = user.email.charAt(0).toUpperCase();
    listenToProjects();
  } else {
    currentUser = null;
    selectedProjectId = null;
    projectsCache = [];
    tasksCache = [];
    if (unsubscribeProjects) unsubscribeProjects();
    if (unsubscribeTasks) unsubscribeTasks();
    authScreen.style.display = "flex";
    appContainer.style.display = "none";
  }
});

// SIDEBAR VIEW SWITCHING (Tasks vs Analytics)
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const targetView = btn.getAttribute("data-view");
    document.querySelectorAll(".view-section").forEach(sec => sec.style.display = "none");
    document.getElementById(targetView).style.display = "block";

    if (targetView === "reports-view") {
      document.getElementById("page-title").innerText = "Analytics & Reports";
      document.getElementById("page-subtitle").innerText = "Visual metrics and progress overview";
      renderAnalyticsCharts();
    } else {
      document.getElementById("page-title").innerText = "Task Board";
      document.getElementById("page-subtitle").innerText = "Manage and track your project workflow";
    }
  });
});

// FIRESTORE LISTENERS
function listenToProjects() {
  const q = query(collection(db, "projects"), where("userId", "==", currentUser.uid));
  unsubscribeProjects = onSnapshot(q, (snapshot) => {
    projectsCache = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    updateProjectDropdown();
  });
}

function updateProjectDropdown() {
  const selector = document.getElementById("project-selector");
  const deleteBtn = document.getElementById("delete-project-btn");

  if (projectsCache.length === 0) {
    selector.innerHTML = `<option value="">No projects created</option>`;
    selectedProjectId = null;
    tasksCache = [];
    if (deleteBtn) deleteBtn.disabled = true;
    renderDashboard();
    return;
  }

  if (deleteBtn) deleteBtn.disabled = false;
  selector.innerHTML = projectsCache.map(p => `<option value="${p.id}">${p.name}</option>`).join("");
  
  if (!selectedProjectId || !projectsCache.find(p => p.id === selectedProjectId)) {
    selectedProjectId = projectsCache[0].id;
  }
  
  selector.value = selectedProjectId;
  listenToTasks();
}

document.getElementById("project-selector").addEventListener("change", (e) => {
  selectedProjectId = e.target.value;
  listenToTasks();
});

document.getElementById("create-project-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("project-name-input");
  const name = input.value.trim();
  if (!currentUser || !name) return;

  try {
    const docRef = await addDoc(collection(db, "projects"), {
      name, userId: currentUser.uid, createdAt: serverTimestamp()
    });
    selectedProjectId = docRef.id;
    input.value = "";
  } catch (err) { alert(err.message); }
});

// DELETE CURRENT PROJECT
document.getElementById("delete-project-btn").addEventListener("click", async () => {
  const activeProjectId = selectedProjectId || document.getElementById("project-selector").value;

  if (!activeProjectId) {
    alert("No project selected to delete.");
    return;
  }

  const currentProject = projectsCache.find(p => p.id === activeProjectId);
  const projectName = currentProject ? currentProject.name : "this project";

  const confirmDelete = confirm(`Are you sure you want to delete "${projectName}"? All associated tasks will be permanently removed.`);
  if (!confirmDelete) return;

  try {
    const projectTasks = tasksCache.filter(t => t.projectId === activeProjectId);
    const deletePromises = projectTasks.map(task => deleteDoc(doc(db, "tasks", task.id)));
    await Promise.all(deletePromises);

    await deleteDoc(doc(db, "projects", activeProjectId));
    selectedProjectId = null;
  } catch (err) {
    console.error("Error deleting project:", err);
    alert("Failed to delete project: " + err.message);
  }
});

function listenToTasks() {
  const activeProjectId = selectedProjectId || document.getElementById("project-selector").value;

  if (unsubscribeTasks) unsubscribeTasks();
  if (!activeProjectId) return;

  const q = query(
    collection(db, "tasks"), 
    where("projectId", "==", activeProjectId),
    where("userId", "==", currentUser.uid)
  );

  unsubscribeTasks = onSnapshot(q, (snapshot) => {
    tasksCache = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderDashboard();
    renderAnalyticsCharts();
  });
}

// TASK CREATION
document.getElementById("modal-task-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const activeProjectId = selectedProjectId || document.getElementById("project-selector").value;

  if (!activeProjectId || activeProjectId === "") {
    return alert("Create or select a project first!");
  }

  if (!currentUser) return alert("You must be logged in.");

  const title = document.getElementById("task-title-input").value.trim();
  const tag = document.getElementById("task-tag-input").value.trim() || "General";
  const priority = document.getElementById("task-priority-input").value;
  const dueDate = document.getElementById("task-date-input").value || "No Date";

  try {
    await addDoc(collection(db, "tasks"), {
      projectId: activeProjectId,
      userId: currentUser.uid,
      title, 
      tag, 
      priority, 
      dueDate, 
      status: "To Do", 
      createdAt: serverTimestamp()
    });
    document.getElementById("task-modal").style.display = "none";
    e.target.reset();
  } catch (err) { 
    alert(err.message); 
  }
});

// DASHBOARD RENDER
function renderDashboard() {
  const priorityFilter = document.getElementById("filter-priority").value;
  const searchQuery = document.getElementById("search-input").value.toLowerCase();

  const filteredTasks = tasksCache.filter(task => {
    const matchesPriority = priorityFilter === "ALL" || task.priority === priorityFilter;
    const matchesSearch = task.title.toLowerCase().includes(searchQuery) || task.tag.toLowerCase().includes(searchQuery);
    return matchesPriority && matchesSearch;
  });

  const lists = {
    "To Do": document.getElementById("todo-list"),
    "In Progress": document.getElementById("in-progress-list"),
    "In Review": document.getElementById("in-review-list"),
    "Done": document.getElementById("done-list")
  };
  const counts = { "To Do": 0, "In Progress": 0, "In Review": 0, "Done": 0 };
  const priorities = { High: 0, Medium: 0, Low: 0 };

  Object.values(lists).forEach(el => el.innerHTML = "");
  tasksCache.forEach(t => { if (priorities[t.priority] !== undefined) priorities[t.priority]++; });

  filteredTasks.forEach(task => {
    if (lists[task.status]) {
      counts[task.status]++;
      const card = document.createElement("div");
      card.className = "task-card";
      card.draggable = true;
      card.dataset.id = task.id;

      card.innerHTML = `
        <div class="card-top">
          <span class="card-tag">${task.tag}</span>
          <button class="delete-btn" data-id="${task.id}">&times;</button>
        </div>
        <div class="card-title">${task.title}</div>
        <div class="card-meta">
          <span>📅 ${task.dueDate}</span>
          <span class="p-badge ${task.priority}">${task.priority}</span>
        </div>
      `;

      card.querySelector(".delete-btn").addEventListener("click", async (e) => {
        e.stopPropagation();
        await deleteDoc(doc(db, "tasks", task.id));
      });

      card.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", task.id));
      lists[task.status].appendChild(card);
    }
  });

  document.getElementById("todo-count").innerText = counts["To Do"];
  document.getElementById("progress-count").innerText = counts["In Progress"];
  document.getElementById("review-count").innerText = counts["In Review"];
  document.getElementById("done-count").innerText = counts["Done"];

  document.getElementById("metric-total").innerText = tasksCache.length;
  document.getElementById("metric-progress").innerText = counts["In Progress"];
  document.getElementById("metric-completed").innerText = counts["Done"];

  document.getElementById("high-count").innerText = priorities.High;
  document.getElementById("medium-count").innerText = priorities.Medium;
  document.getElementById("low-count").innerText = priorities.Low;

  renderMiniDonut(counts);
}

document.querySelectorAll(".kanban-column").forEach(col => {
  col.addEventListener("dragover", e => e.preventDefault());
  col.addEventListener("drop", async (e) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/plain");
    const newStatus = col.dataset.status;
    if (taskId && newStatus) {
      await updateDoc(doc(db, "tasks", taskId), { status: newStatus });
    }
  });
});

function renderMiniDonut(counts) {
  const ctx = document.getElementById("miniDonutChart").getContext("2d");
  if (miniDonutChartInstance) miniDonutChartInstance.destroy();
  miniDonutChartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      datasets: [{
        data: [counts["Done"], counts["In Progress"], counts["To Do"]],
        backgroundColor: ["#4ade80", "#fbbf24", "#38bdf8"],
        borderWidth: 0
      }]
    },
    options: { cutout: "72%", plugins: { legend: { display: false } }, responsive: true }
  });
}

// RENDER ANALYTICS CHARTS (HIGH-CONTRAST TEXT & AXES)
function renderAnalyticsCharts() {
  const reportsView = document.getElementById("reports-view");
  if (reportsView.style.display === "none") return;

  const statusCounts = { "To Do": 0, "In Progress": 0, "In Review": 0, "Done": 0 };
  const priorityCounts = { High: 0, Medium: 0, Low: 0 };

  tasksCache.forEach(t => {
    if (statusCounts[t.status] !== undefined) statusCounts[t.status]++;
    if (priorityCounts[t.priority] !== undefined) priorityCounts[t.priority]++;
  });

  const darkThemeOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: "#f8fafc",
          font: { size: 12, weight: "600" }
        }
      }
    }
  };

  // Status Bar Chart
  const statusCtx = document.getElementById("statusChart").getContext("2d");
  if (statusChartInstance) statusChartInstance.destroy();
  statusChartInstance = new Chart(statusCtx, {
    type: "bar",
    data: {
      labels: Object.keys(statusCounts),
      datasets: [{
        label: "Tasks",
        data: Object.values(statusCounts),
        backgroundColor: ["#38bdf8", "#fbbf24", "#a855f7", "#4ade80"],
        borderRadius: 6
      }]
    },
    options: {
      ...darkThemeOptions,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          ticks: { color: "#cbd5e1", font: { size: 12, weight: "500" } },
          grid: { color: "rgba(51, 65, 85, 0.4)" }
        },
        y: {
          ticks: { color: "#cbd5e1", font: { size: 12 } },
          grid: { color: "rgba(51, 65, 85, 0.4)" }
        }
      }
    }
  });

  // Priority Pie Chart
  const priorityCtx = document.getElementById("priorityChart").getContext("2d");
  if (priorityChartInstance) priorityChartInstance.destroy();
  priorityChartInstance = new Chart(priorityCtx, {
    type: "pie",
    data: {
      labels: Object.keys(priorityCounts),
      datasets: [{
        data: Object.values(priorityCounts),
        backgroundColor: ["#f87171", "#fbbf24", "#4ade80"],
        borderWidth: 2,
        borderColor: "#1e293b"
      }]
    },
    options: darkThemeOptions
  });
}

// MODAL LISTENERS
document.getElementById("open-task-modal-btn").addEventListener("click", () => document.getElementById("task-modal").style.display = "flex");
document.querySelector(".close-modal").addEventListener("click", () => document.getElementById("task-modal").style.display = "none");
document.getElementById("filter-priority").addEventListener("change", renderDashboard);
document.getElementById("search-input").addEventListener("input", renderDashboard);