let graph = { nodes: [], links: [] };
let selectedAlgorithm = null;
let startNode = null;
let endNode = null;
let addingEdge = false;
let edgeStart = null;
let removingElement = false;
let animationSpeed = 500;

const margin = 40;
const width = 800 - 2 * margin;
const height = 600 - 2 * margin;

const svg = d3.select('#visualization')
    .append('svg')
    .attr('viewBox', `0 0 ${width + 2 * margin} ${height + 2 * margin}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .style('width', '100%')
    .style('height', 'auto');

const g = svg.append('g')
    .attr('transform', `translate(${margin}, ${margin})`);

// Remove the existing border code and replace it with this:
const border = g.append('rect')
    .attr('x', -margin)
    .attr('y', -margin)
    .attr('width', width + 2 * margin)
    .attr('height', height + 2 * margin)
    .attr('fill', 'none')
    .attr('stroke', '#000')
    .attr('stroke-width', 2);

// Modify the zoom behavior to include the border scaling
const zoom = d3.zoom()
    .scaleExtent([0.1, 4])
    .on('zoom', (event) => {
        g.attr('transform', event.transform);
        border.attr('stroke-width', 2 / event.transform.k);
    });

svg.call(zoom);

const simulation = d3.forceSimulation()
    .force('link', d3.forceLink().id(d => d.id).distance(100))
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .force('collision', d3.forceCollide().radius(20))
    .force('x', d3.forceX(width / 2).strength(0.1))
    .force('y', d3.forceY(height / 2).strength(0.1));

function updateGraph() {
    const link = g.selectAll('line')
        .data(graph.links)
        .join('line')
        .attr('stroke', '#999')
        .attr('stroke-opacity', 0.6)
        .attr('stroke-width', 2);

    const node = g.selectAll('g.node')
        .data(graph.nodes)
        .join('g')
        .attr('class', 'node')
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

    updateStats();
}

function updateStats() {
    document.getElementById('node-count').textContent = graph.nodes.length;
    document.getElementById('edge-count').textContent = graph.links.length;
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
    event.stopPropagation();
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

function handleSvgClick(event) {
    if (event.target.tagName === 'svg') {
        const [x, y] = d3.pointer(event);
        if (x > margin && x < width + margin && y > margin && y < height + margin) {
            const newNode = { 
                id: graph.nodes.length.toString(), 
                x: x - margin, 
                y: y - margin 
            };
            graph.nodes.push(newNode);
            updateGraph();
        }
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

function clearGraph() {
    graph.nodes = [];
    graph.links = [];
    startNode = null;
    endNode = null;
    updateNodeInfo();
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
    const startTime = performance.now();

    switch (selectedAlgorithm) {
        case 'bfs':
            bfs(startNode);
            break;
        case 'dfs':
            dfs(startNode);
            break;
    }

    const endTime = performance.now();
    document.getElementById('execution-time').textContent = `${(endTime - startTime).toFixed(2)} ms`;
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
        return new Promise((resolve) => {
            if (i >= queue.length) {
                if (endNode && parent.has(endNode)) {
                    highlightPath(parent, endNode);
                }
                resolve();
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

            setTimeout(() => {
                animate(i + 1).then(resolve);
            }, animationSpeed);
        });
    }

    animate(0);
}

function dfs(start) {
    const visited = new Set();
    const parent = new Map();

    function dfsRecursive(node) {
        return new Promise((resolve) => {
            visited.add(node);
            colorNode(node, 'purple');

            if (node === endNode) {
                highlightPath(parent, endNode);
                resolve(true);
                return;
            }

            const neighbors = graph.links
                .filter(l => l.source.id === node.id)
                .map(l => graph.nodes.find(n => n.id === l.target))
                .filter(n => !visited.has(n));

            function processNeighbors(index) {
                if (index >= neighbors.length) {
                    resolve(false);
                    return;
                }

                const neighbor = neighbors[index];
                parent.set(neighbor, node);

                setTimeout(() => {
                    dfsRecursive(neighbor).then(found => {
                        if (found) {
                            resolve(true);
                        } else {
                            processNeighbors(index + 1);
                        }
                    });
                }, animationSpeed);
            }

            processNeighbors(0);
        });
    }

    dfsRecursive(start);
}

function colorNode(node, color) {
    svg.selectAll('circle')
        .filter(d => d === node)
        .transition()
        .duration(animationSpeed / 2)
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
        setTimeout(() => colorNode(node, 'orange'), index * animationSpeed);
    });
}

function updateAnimationSpeed() {
    const speedSlider = document.getElementById('speed-slider');
    animationSpeed = 1000 / speedSlider.value;
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

document.getElementById('generate-graph').addEventListener('click', generateRandomGraph);
document.getElementById('clear-graph').addEventListener('click', clearGraph);
document.getElementById('add-edge').addEventListener('click', addEdge);
document.getElementById('remove-element').addEventListener('click', removeElement);
document.getElementById('algorithm-select').addEventListener('change', selectAlgorithm);
document.getElementById('run-algorithm').addEventListener('click', runAlgorithm);
document.getElementById('speed-slider').addEventListener('input', updateAnimationSpeed);

svg.on('click', handleSvgClick);