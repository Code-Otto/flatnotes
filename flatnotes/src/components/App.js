import { Editor } from "@toast-ui/vue-editor";
import { Viewer } from "@toast-ui/vue-editor";

import api from "../api";
import * as constants from "../constants";
import { Note, SearchResult } from "./classes";
import EventBus from "../eventBus";
import * as helpers from "../helpers";

export default {
  components: {
    Viewer,
    Editor,
  },

  data: function() {
    return constants.dataDefaults();
  },

  methods: {
    route: function() {
      let path = window.location.pathname.split("/");
      let basePath = path[1];

      // Home Page
      if (basePath == "") {
        this.getNotes(5, "lastModified", "desc");
        this.currentView = this.views.home;
      }

      // Search
      else if (basePath == constants.basePaths.search) {
        this.searchTerm = helpers.getSearchParam(constants.params.searchTerm);
        this.getSearchResults();
        this.currentView = this.views.search;
      }

      // Note
      else if (basePath == constants.basePaths.note) {
        let noteTitle = path[2];
        this.loadNote(noteTitle);
        this.currentView = this.views.note;
      }

      // Login
      else if (basePath == constants.basePaths.login) {
        this.currentView = this.views.login;
      }

      this.updateDocumentTitle();
    },

    navigate: function(href, e) {
      if (e != undefined && e.ctrlKey == true) {
        window.open(href);
      } else {
        history.pushState(null, "", href);
        this.resetData();
        this.route();
      }
    },

    resetData: function() {
      Object.assign(this.$data, constants.dataDefaults());
    },

    updateDocumentTitle: function() {
      let pageTitleSuffix = null;
      if (this.currentView == this.views.login) {
        pageTitleSuffix = "Login";
      } else if (this.currentView == this.views.search) {
        pageTitleSuffix = "Search";
      } else if (
        this.currentView == this.views.note &&
        this.currentNote != null
      ) {
        pageTitleSuffix = this.currentNote.title;
      }
      window.document.title =
        (pageTitleSuffix ? `${pageTitleSuffix} - ` : "") + "flatnotes";
    },

    login: function() {
      let parent = this;
      api
        .post("/api/token", {
          username: this.usernameInput,
          password: this.passwordInput,
        })
        .then(function(response) {
          sessionStorage.setItem("token", response.data.access_token);
          if (parent.rememberMeInput == true) {
            localStorage.setItem("token", response.data.access_token);
          }
          let redirectPath = helpers.getSearchParam(constants.params.redirect);
          parent.navigate(redirectPath || "/");
        })
        .catch(function(error) {
          if ([400, 422].includes(error.response.status)) {
            parent.$bvToast.toast("Incorrect Username or Password ✘", {
              variant: "danger",
              noCloseButton: true,
            });
          }
        })
        .finally(function() {
          parent.usernameInput = null;
          parent.passwordInput = null;
          parent.rememberMeInput = false;
        });
    },

    logout: function() {
      sessionStorage.removeItem("token");
      localStorage.removeItem("token");
      this.navigate(`/${constants.basePaths.login}`);
    },

    getNotes: function(limit = null, sort = "filename", order = "asc") {
      let parent = this;
      api
        .get("/api/notes", {
          params: { limit: limit, sort: sort, order: order },
        })
        .then(function(response) {
          parent.notes = [];
          response.data.forEach(function(note) {
            parent.notes.push(new Note(note.filename, note.lastModified));
          });
        });
    },

    search: function() {
      this.navigate(
        `/${constants.basePaths.search}?${
          constants.params.searchTerm
        }=${encodeURI(this.searchTerm)}`
      );
    },

    getSearchResults: function() {
      let parent = this;
      api
        .get("/api/search", { params: { term: this.searchTerm } })
        .then(function(response) {
          parent.searchResults = [];
          response.data.forEach(function(result) {
            parent.searchResults.push(
              new SearchResult(
                result.filename,
                result.lastModified,
                result.titleHighlights,
                result.contentHighlights
              )
            );
          });
        });
    },

    getContentForEditor: function() {
      let draftContent = localStorage.getItem(this.currentNote.filename);
      if (draftContent) {
        if (confirm("Do you want to resume the saved draft?")) {
          return draftContent;
        } else {
          localStorage.removeItem(this.currentNote.filename);
        }
      }
      return this.currentNote.content;
    },

    loadNote: function(filename) {
      let parent = this;
      api
        .get(`/api/notes/${filename}.${constants.markdownExt}`)
        .then(function(response) {
          parent.currentNote = new Note(
            response.data.filename,
            response.data.lastModified,
            response.data.content
          );
          parent.updateDocumentTitle();
        });
    },

    toggleEditMode: function() {
      // To Edit Mode
      if (this.editMode == false) {
        this.titleInput = this.currentNote.title;
        let draftContent = localStorage.getItem(this.currentNote.filename);
        // Draft
        if (draftContent && confirm("Do you want to resume the saved draft?")) {
          this.initialContent = draftContent;
        }
        // Non-Draft
        else {
          localStorage.removeItem(this.currentNote.filename);
          this.initialContent = this.currentNote.content;
        }
      }
      // To View Mode
      else {
        this.titleInput = null;
        this.initialContent = null;
      }
      // Always
      this.editMode = !this.editMode;
    },

    newNote: function() {
      this.currentNote = new Note();
      this.toggleEditMode();
      this.currentView = this.views.note;
    },

    getEditorContent: function() {
      return this.$refs.toastUiEditor.invoke("getMarkdown");
    },

    clearDraftSaveTimeout: function() {
      if (this.draftSaveTimeout != null) {
        clearTimeout(this.draftSaveTimeout);
      }
    },

    startDraftSaveTimeout: function() {
      this.clearDraftSaveTimeout();
      this.draftSaveTimeout = setTimeout(this.saveDraft, 1000);
    },

    saveDraft: function() {
      localStorage.setItem(this.currentNote.filename, this.getEditorContent());
    },

    saveNote: function() {
      let newContent = this.getEditorContent();

      // New Note
      if (this.currentNote.lastModified == null) {
        api
          .post(`/api/notes`, {
            filename: `${this.titleInput}.${constants.markdownExt}`,
            content: newContent,
          })
          .then(this.saveNoteResponseHandler);
      }

      // Modified Note
      else if (
        newContent != this.currentNote.content ||
        this.titleInput != this.currentNote.title
      ) {
        api
          .patch(`/api/notes/${this.currentNote.filename}`, {
            newFilename: `${this.titleInput}.${this.currentNote.ext}`,
            newContent: newContent,
          })
          .then(this.saveNoteResponseHandler);
      }

      // No Change
      else {
        this.toggleEditMode();
      }
    },

    saveNoteResponseHandler: function(response) {
      localStorage.removeItem(this.currentNote.filename);
      this.currentNote = new Note(
        response.data.filename,
        response.data.lastModified,
        response.data.content
      );
      this.updateDocumentTitle();
      history.replaceState(null, "", this.currentNote.href);
      this.toggleEditMode();
    },

    cancelNote: function() {
      localStorage.removeItem(this.currentNote.filename);
      if (this.currentNote.lastModified == null) {
        // Cancelling a new note
        this.currentNote = null;
        this.currentView = this.views.home;
      }
      this.toggleEditMode();
    },

    deleteNote: function() {
      let parent = this;
      if (
        confirm(
          `Are you sure you want to delete the note '${this.currentNote.title}'?`
        )
      ) {
        api.delete(`/api/notes/${this.currentNote.filename}`).then(function() {
          parent.navigate("/");
          parent.$bvToast.toast("Note Deleted ✓", {
            variant: "success",
            noCloseButton: true,
          });
        });
      }
    },

    keyboardShortcuts: function(e) {
      // 'e' to Edit
      if (
        e.key == "e" &&
        this.currentView == this.views.note &&
        this.editMode == false
      ) {
        e.preventDefault();
        this.toggleEditMode();
      }

      // 'CTRL + s' to Save
      // else if (
      //   e.key == "s" &&
      //   e.ctrlKey == true &&
      //   this.currentView == this.views.note &&
      //   this.editMode == true
      // ) {
      //   e.preventDefault();
      //   this.saveNote();
      // }
    },
  },

  created: function() {
    EventBus.$on("navigate", this.navigate);
    document.addEventListener("keydown", this.keyboardShortcuts);

    let token = localStorage.getItem("token");
    if (token != null) {
      sessionStorage.setItem("token", token);
    }

    this.route();
  },

  mounted: function() {
    window.addEventListener("popstate", this.route);
  },
};
