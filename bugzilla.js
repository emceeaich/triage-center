var API_BASE = "https://bugzilla.mozilla.org/rest/";

var gAPIKey = null; // string or false once the user makes a choice

/**
 * @returns d3.request
 */
function make_api_request(path, params, data, method) {
  var uri = API_BASE + path;
  if (params) {
    uri += "?" + params.toString();
  }
  var r = d3.json(uri);
  if (gAPIKey) {
    r.header("X-BUGZILLA-API-KEY", gAPIKey);
  }
  if (data) {
    r.header("Content-Type", "application/json");
    data = JSON.stringify(data);
  }
  if (!method) {
    if (data) {
      method = "POST";
    } else {
      method = "GET";
    }
  }
  return r.send(method, data);
}

var gComponents;

function get_components() {
  $("#component-loading").progressbar({ value: false });
  return fetch("components-min.json")
    .then(function(r) { return r.json(); })
    .then(function(r) {
      gComponents = r;
      selected_from_url();
      $("#component-loading").hide();
    });
}

function selected_from_url() {
  var sp = new URLSearchParams(window.location.search);
  var components = new Set(sp.getAll("component"));
  gComponents.forEach(function(c) {
    var test = c.product_name + ":" + c.component_name;
    c.selected = components.has(test);
  });
  if (gAPIKey != null) {
    setup_queries();
  }
}

$(function() {
  $(".badge").hide();
  $("#tabs").tabs({ heightStyle: "fill", active: 1 });
  $("#api_key_container").dialog({
    autoOpen: true,
    buttons: [
      {
        text: "ok",
        click: function() {
          if ($("#api_key").val() == "") {
            return;
          }
          gAPIKey = $("#api_key").val();
          if (gComponents) {
            setup_queries();
          }
          $(this).dialog("close");
        },
      },
      {
        text: "Skip (read-only)",
        click: function() {
          gAPIKey = false;
          if (gComponents) {
            setup_queries();
          }
          $(this).dialog("close");
        },
      },
    ],
    modal: true,
  });
  $("#stale-inner").accordion({ heightStyle: "content", collapsible: true, active: false });

  get_components().then(setup_components);
  d3.select("#filter").on("input", function() {
    setup_components();
  });
  window.addEventListener("popstate", function() {
    selected_from_url();
    setup_components();
  });
});

function setup_components() {
  var search = d3.select("#filter").property("value").toLowerCase().split(/\s+/).filter(function(w) { return w.length > 0; });
  var filtered;
  if (search.length == 0) {
    filtered = gComponents;
  } else {
    filtered = gComponents.filter(function(c) {
      var search_name = (c.product_name + ": " + c.component_name + " " + c.component_description).toLowerCase();
      var found = true;
      search.forEach(function(w) {
        if (search_name.indexOf(w) == -1) {
          found = false;
        }
      });
      return found;
    });
  }
  var rows = d3.select("#components tbody").selectAll("tr")
    .data(filtered, function(c) { return c.product_id + "_" + c.component_id; });
  var new_rows = rows.enter().append("tr");
  new_rows.on("click", function(d) {
    d.selected = !d.selected;
    d3.select(this).select("input").property("checked", d.selected);
    navigate_url();
    setup_queries();
  });
  new_rows.append("th").append("input")
    .attr("type", "checkbox");
  new_rows.append("th").text(function(d) {
    return d.product_name + ": " + d.component_name;
  });
  new_rows.append("td").text(function(d) {
    return d.component_description;
  });
  rows.exit().remove();
  rows.selectAll("input").property("checked", function(d) { return !!d.selected; });
  document.getElementById('filter').removeAttribute('disabled');
}

function setup_queries() {
  var selected = gComponents.filter(function(c) { return c.selected; });
  var products = new Set();
  var components = new Set();
  selected.forEach(function(c) {
    products.add(c.product_name);
    components.add(c.component_name);
  });

  var common_params = new URLSearchParams();
  Array.from(products.values()).forEach(function(p) {
    common_params.append("product", p);
  });
  Array.from(components.values()).forEach(function(c) {
    common_params.append("component", c);
  });

  var to_triage = make_search({
    priority: "--",
    n1: 1,
    f1: "flagtypes.name",
    o1: "substring",
    v1: "needinfo",
    resolution: "---",
    chfield: "[Bug creation]",
    chfieldto: "Now",
    query_format: "advanced",
    chfieldfrom: "2016-06-01",
  }, common_params);
  document.getElementById("triage-list").href = "https://bugzilla.mozilla.org/buglist.cgi?" + to_triage.toString();
  populate_table($("#need-decision"), to_triage, $("#need-decision-marker"));

  var stale_needinfo = make_search({
    f1: "flagtypes.name",
    o1: "substring",
    v1: "needinfo",
    f2: "delta_ts",
    o2: "lessthan", // means "older than"
    v2: "14d",
    resolution: "---",
    query_format: "advanced",
  }, common_params);
  document.getElementById("stuck-list").href = "https://bugzilla.mozilla.org/buglist.cgi?" + stale_needinfo.toString();
  populate_table($("#needinfo-stale"), stale_needinfo, $("#needinfo-stale-marker"));

  var stale_review = make_search({
    f1: "flagtypes.name",
    o1: "regexp",
    v1: "(review|superreview|ui-review|feedback|a11y-review)\\?",
    resolution: "---",
    f2: "delta_ts",
    o2: "lessthan", // means "older than"
    v2: "5d",
    query_format: "advanced",
  }, common_params);
  document.getElementById("review-list").href = "https://bugzilla.mozilla.org/buglist.cgi?" + stale_review.toString();
  populate_table($("#review-stale"), stale_review, $("#review-stale-marker"));
}

function navigate_url() {
  var u = new URL(window.location.href);
  var sp = u.searchParams;
  sp.delete("component");
  var selected = gComponents.filter(function(c) { return c.selected; });
  selected.forEach(function(c) {
    sp.append("component", c.product_name + ":" + c.component_name);
  });
  window.history.pushState(undefined, undefined, u.href);
}

function make_search(o, base) {
  var s = new URLSearchParams(base);
  Object.keys(o).forEach(function(k) {
    var v = o[k];
    if (v instanceof Array) {
      v.forEach(function(v2) {
        s.append(k, v2);
      });
    } else {
      s.append(k, v);
    }
  });
  return s;
}

function bug_description(d) {
  var s = d.product + ": " + d.component + " - " + d.summary;
  if (d.keywords.length) {
    s += " " + d.keywords.join(",");
  }
  s += " Owner: " + d.assigned_to;
  s += " Reporter: " + d.creator;
  s += " Created: " + d3.time.format("%Y-%m-%d %H:%M")(new Date(d.creation_time));
  return s;
}

function populate_table(s, params, marker) {
  $(".p", s).progressbar({ value: false }).off("click");
  make_api_request("bug", params).on("load", function(data) {
    $(".p", s)
      .button({ icons: { primary: 'ui-icon-refresh' }, label: 'Refresh', text: false })
      .on("click", function() { populate_table(s, params, marker); });
    var bugs = data.bugs;
    if (!bugs.length) {
      marker.text("(none!)").removeClass("pending");
    } else {
      marker.text("(" + bugs.length + ")").addClass("pending");
    }
    bugs.sort(function(a, b) { return d3.ascending(a.id, b.id); });
    var rows = d3.select(s[0]).select('.bugtable > tbody').selectAll('tr')
      .data(bugs, function(d) { return d.id; });
    rows.exit().remove();
    var new_rows = rows.enter().append("tr");
    new_rows.append("th").append("a")
      .attr("href", function(d) { return "https://bugzilla.mozilla.org/show_bug.cgi?id=" + d.id; }).text(function(d) { return d.id; });
    new_rows.append("td").classed("bugpriority", true).append(clone_by_id("pselector"));
    new_rows.append("td").classed("bugdescription", true);

    rows.select(".bugpriority > select").property("value", function(d) { return d.priority; })
      .on("change", function(d) { update_priority(d.id, this.value); });
    rows.select(".bugdescription").text(bug_description);
    rows.order();
  });
}

function clone_by_id(id) {
  return function() {
    var n = document.getElementById(id).cloneNode(true);
    n.removeAttribute("id");
    return n;
  };
}

function update_priority(id, p) {
  if (document.getElementById("api_key").value == '') {
    alert("Please enter an API key");
    d3.event.target.value = d3.select(d3.event.target).datum().priority;
    return;
  }
  make_api_request("bug/" + id, null, { priority: p }, "PUT").on("load", function(d) {
    console.log("update", id, p, d);
  });
}
