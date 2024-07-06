let graph = { nodes: [], links: [] };
let selectedAlgorithm = null;
let startNode = null;
let endNode = null;
let addingEdge = false;
let edgeStart = null;
let removingElement = false;

const width = 800;
const height = 600;

const svg = d3.select('#visualization')
    .append('svg')
    .attr('width', width)
    .attr('height', height);

const simulation = d3.forceSimulation()
    .force('link', d3.forceLink().id(d => d.id).distance(100))
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(width / 2, height / 2));

function updateGraph() {
    const link = svg.selectAll('line')
        .data(graph.links)
        .join('line')
        .attr('stroke', '#999')
        .attr('stroke-opacity', 0.6)
        .attr('stroke-width', 2);

    const node = svg.selectAll('g')
        .data(graph.nodes)
        .join('g')
        .call(d3.drag()
            .on('start', dragstarted)
            .on('drag', dragged)
            .on('end', dragended))
        .on('click', handleNodeClick);

    node.selectAll('circle')
        .data(d => [d])
        .join('circle')
        .attr('r', 15)
        .attr('fill', d => {
            if (d === startNode) return 'green';
            if (d === endNode) return 'red';
            return '#69b3a2';
        });

    node.selectAll('text')
        .data(d => [d])
        .join('text')
        .attr('dy', '.35em')
        .attr('text-anchor', 'middle')
        .text(d => d.id);

    simulation.nodes(graph.nodes)
        .on('tick', () => {
            link
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);

            node
                .attr('transform', d => `translate(${d.x},${d.y})`);
        });

    simulation.force('link').links(graph.links);
    simulation.alpha(1).restart();
}

function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
}

function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
}

function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
}

function handleNodeClick(event, d) {
    if (addingEdge) {
        if (edgeStart === null) {
            edgeStart = d;
        } else if (edgeStart !== d) {
            graph.links.push({ source: edgeStart.id, target: d.id });
            edgeStart = null;
            addingEdge = false;
            updateGraph();
        }
    } else if (removingElement) {
        graph.nodes = graph.nodes.filter(n => n !== d);
        graph.links = graph.links.filter(l => l.source !== d && l.target !== d);
        if (startNode === d) startNode = null;
        if (endNode === d) endNode = null;
        updateNodeInfo();
        updateGraph();
    } else {
        if (!startNode) {
            startNode = d;
        } else if (!endNode && d !== startNode) {
            endNode = d;
        } else {
            startNode = d;
            endNode = null;
        }
        updateNodeInfo();
        updateGraph();
    }
}

function updateNodeInfo() {
    document.getElementById('start-node').textContent = startNode ? startNode.id : 'None';
    document.getElementById('end-node').textContent = endNode ? endNode.id : 'None';
}

function selectAlgorithm() {
    selectedAlgorithm = document.getElementById('algorithm-select').value;
    document.getElementById('run-algorithm').disabled = !selectedAlgorithm;
    document.getElementById('current-algorithm').textContent = selectedAlgorithm ? selectedAlgorithm.toUpperCase() : 'None';
}

function generateRandomGraph() {
    graph.nodes = [];
    graph.links = [];
    const numNodes = 10;

    for (let i = 0; i < numNodes; i++) {
        graph.nodes.push({ id: i.toString() });
    }

    for (let i = 0; i < numNodes; i++) {
        const numConnections = Math.floor(Math.random() * 3) + 1;
        for (let j = 0; j < numConnections; j++) {
            const target = Math.floor(Math.random() * numNodes).toString();
            if (target !== i.toString() && !graph.links.some(l => 
                (l.source === i.toString() && l.target === target) || 
                (l.source === target && l.target === i.toString())
            )) {
                graph.links.push({ source: i.toString(), target: target });
            }
        }
    }

    startNode = null;
    endNode = null;
    updateNodeInfo();
    updateGraph();
}

function clearGraph() {
    graph.nodes = [];
    graph.links = [];
    startNode = null;
    endNode = null;
    updateNodeInfo();
    updateGraph();
}

function addNode() {
    const newId = graph.nodes.length.toString();
    graph.nodes.push({ id: newId });
    updateGraph();
}

function addEdge() {
    addingEdge = true;
    removingElement = false;
}

function removeElement() {
    removingElement = true;
    addingEdge = false;
}

function runAlgorithm() {
    if (!graph || !selectedAlgorithm || !startNode) return;

    resetNodeColors();

    switch (selectedAlgorithm) {
        case 'bfs':
            bfs(startNode);
            break;
        case 'dfs':
            dfs(startNode);
            break;
        case 'dijkstra':
            dijkstra(startNode);
            break;
    }
}

function resetNodeColors() {
    svg.selectAll('circle')
        .attr('fill', d => {
            if (d === startNode) return 'green';
            if (d === endNode) return 'red';
            return '#69b3a2';
        });
}

function bfs(start) {
    const queue = [start];
    const visited = new Set([start]);
    const parent = new Map();

    function animate(i) {
        if (i >= queue.length) {
            if (endNode && parent.has(endNode)) {
                highlightPath(parent, endNode);
            }
            return;
        }

        const node = queue[i];
        colorNode(node, 'purple');

        graph.links
            .filter(link => link.source.id === node.id)
            .forEach(link => {
                const target = graph.nodes.find(n => n.id === link.target);
                if (!visited.has(target)) {
                    queue.push(target);
                    visited.add(target);
                    parent.set(target, node);
                }
            });

        setTimeout(() => animate(i + 1), 500);
    }

    animate(0);
}

function dfs(start) {
    const visited = new Set();
    const parent = new Map();

    function dfsRecursive(node) {
        visited.add(node);
        colorNode(node, 'purple');

        if (node === endNode) {
            highlightPath(parent, endNode);
            return true;
        }

        for (const link of graph.links.filter(l => l.source.id === node.id)) {
            const target = graph.nodes.find(n => n.id === link.target);
            if (!visited.has(target)) {
                parent.set(target, node);
                if (dfsRecursive(target)) return true;
            }
        }

        return false;
    }

    setTimeout(() => dfsRecursive(start), 0);
}

function dijkstra(start) {
    const distances = new Map(graph.nodes.map(node => [node, Infinity]));
    distances.set(start, 0);
    const parent = new Map();
    const unvisited = new Set(graph.nodes);

    function animate() {
        if (unvisited.size === 0) {
            if (endNode) highlightPath(parent, endNode);
            return;
        }

        const current = [...unvisited].reduce((a, b) => distances.get(a) < distances.get(b) ? a : b);
        unvisited.delete(current);
        colorNode(current, 'purple');

        graph.links
            .filter(link => link.source.id === current.id)
            .forEach(link => {
                const target = graph.nodes.find(n => n.id === link.target);
                const distance = distances.get(current) + 1; // Assuming unit weight
                if (distance < distances.get(target)) {
                    distances.set(target, distance);
                    parent.set(target, current);
                }
            });

        setTimeout(animate, 500);
    }

    animate();
}

function colorNode(node, color) {
    svg.selectAll('circle')
        .filter(d => d === node)
        .transition()
        .duration(500)
        .attr('fill', color);
}

function highlightPath(parent, end) {
    let current = end;
    const path = [];
    while (current) {
        path.unshift(current);
        current = parent.get(current);
    }

    path.forEach((node, index) => {
        setTimeout(() => colorNode(node, 'orange'), index * 500);
    });
}

document.getElementById('generate-graph').addEventListener('click', generateRandomGraph);
document.getElementById('clear-graph').addEventListener('click', clearGraph);
document.getElementById('add-node').addEventListener('click', addNode);
document.getElementById('add-edge').addEventListener('click', addEdge);
document.getElementById('remove-element').addEventListener('click', removeElement);
document.getElementById('algorithm-select').addEventListener('change', selectAlgorithm);
document.getElementById('run-algorithm').addEventListener('click', runAlgorithm);

generateRandomGraph();