import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { PCA } from 'ml-pca';
import pointInPolygon from 'point-in-polygon'; // Helper to check if point is inside the lasso path

function App() {
  const svgRef = useRef();
  const projectionSvgRef = useRef(); // New SVG for projected points
  const [embeddings, setEmbeddings] = useState([]);
  const [labels, setLabels] = useState([]);

  // Fetch t-SNE embeddings and labels
  useEffect(() => {
    const fetchData = async () => {
      try {
        const embeddingsResponse = await fetch('http://localhost:8000/data/tsne');
        const labelsResponse = await fetch('http://localhost:8000/data/labels');

        if (!embeddingsResponse.ok || !labelsResponse.ok) {
          throw new Error('Network response was not ok');
        }

        const embeddingsData = await embeddingsResponse.json();
        const labelsData = await labelsResponse.json();

        setEmbeddings(embeddingsData);
        setLabels(labelsData);

      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };

    fetchData();
  }, []);

  // Perform PCA projection and plot the new points
  const projectSelectedPoints = (selected) => {
    if (selected.length > 1) {
      const selectedData = selected.map(point => point.d); // Extract the points

      // Apply PCA
      const pca = new PCA(selectedData);
      const pcaResult = pca.predict(selectedData, { nComponents: 2 }).data; // Project into 2D space

      console.log('PCA Result:', pcaResult); // Log the new projections

      // Render the projected points in a new SVG
      const width = 400;
      const height = 400;
      const margin = { top: 20, right: 20, bottom: 30, left: 40 };

      const projectionSvg = d3.select(projectionSvgRef.current);
      projectionSvg.selectAll('*').remove(); // Clear previous elements

      // Create new scales
      const x = d3.scaleLinear().domain(d3.extent(pcaResult, d => d[0])).range([margin.left, width - margin.right]);
      const y = d3.scaleLinear().domain(d3.extent(pcaResult, d => d[1])).range([height - margin.bottom, margin.top]);

      // Create new axes
      projectionSvg.append('g')
        .attr('transform', `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x));
      projectionSvg.append('g')
        .attr('transform', `translate(${margin.left},0)`)
        .call(d3.axisLeft(y));

      // Plot the projected points
      projectionSvg.append('g')
        .selectAll('circle')
        .data(pcaResult)
        .enter().append('circle')
        .attr('cx', d => x(d[0]))
        .attr('cy', d => y(d[1]))
        .attr('r', 3)
        .attr('fill', 'blue');
    }
  };

  // Render D3.js scatter plot with lasso tool and zoom
  useEffect(() => {
    if (embeddings.length > 0 && labels.length > 0) {
      const svg = d3.select(svgRef.current);
      svg.selectAll('*').remove(); // Clear previous elements

      const width = 800;
      const height = 600;
      const margin = { top: 20, right: 20, bottom: 30, left: 40 };

      // Create scales
      let x = d3.scaleLinear().domain(d3.extent(embeddings, d => d[0])).range([margin.left, width - margin.right]);
      let y = d3.scaleLinear().domain(d3.extent(embeddings, d => d[1])).range([height - margin.bottom, margin.top]);

      // Create axes
      const xAxis = svg.append('g')
        .attr('transform', `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(x));
      const yAxis = svg.append('g')
        .attr('transform', `translate(${margin.left},0)`)
        .call(d3.axisLeft(y));

      // Create the points
      const points = svg.append('g')
        .selectAll('circle')
        .data(embeddings)
        .enter().append('circle')
        .attr('cx', d => x(d[0]))
        .attr('cy', d => y(d[1]))
        .attr('r', 3)
        .attr('fill', (d, i) => d3.schemeCategory10[labels[i] % 10]);

      // Freeform lasso selection logic
      let isLassoing = false;
      let lassoPoints = [];

      // Add lasso path
      const lassoPath = svg.append('path')
        .attr('fill', 'rgba(173,216,230, 0.4)')
        .attr('stroke', 'blue')
        .attr('stroke-width', 2)
        .attr('d', '');

      let zoomTransform = d3.zoomIdentity; // Store the current zoom transformation

      // Mouse down event to start lasso
      svg.on('mousedown', function (event) {
        isLassoing = true;
        lassoPoints = [d3.pointer(event)]; // Start capturing lasso points
        lassoPath.attr('d', `M ${lassoPoints[0][0]},${lassoPoints[0][1]}`); // Start the lasso path
      });

      // Mouse move event to draw lasso path
      svg.on('mousemove', function (event) {
        if (!isLassoing) return;
        const point = d3.pointer(event);
        lassoPoints.push(point);
        lassoPath.attr('d', `${lassoPath.attr('d')} L ${point[0]},${point[1]}`);
      });

      // Mouse up event to end lasso and select points
      svg.on('mouseup', function () {
        if (!isLassoing) return;
        isLassoing = false;

        // Close the lasso path
        lassoPath.attr('d', `${lassoPath.attr('d')} Z`);

        // Check which points are inside the lasso
        const selected = [];
        points.attr('fill', function (d, i) {
          const cx = zoomTransform.rescaleX(x)(d[0]); // Adjust for zoom
          const cy = zoomTransform.rescaleY(y)(d[1]); // Adjust for zoom
          if (pointInPolygon([cx, cy], lassoPoints)) {
            selected.push({ d, i }); // Add to the selected points
            return 'red'; // Highlight selected points
          }
          return d3.schemeCategory10[labels[i] % 10]; // Reset color for non-selected points
        });

        console.log('Selected Points:', selected);

        // Project selected points to new space
        projectSelectedPoints(selected);

        // Clear lasso path and reset lasso points
        lassoPoints = [];
        lassoPath.attr('d', '');
      });

      // Add zoom functionality
      const zoom = d3.zoom()
        .scaleExtent([0.5, 10]) // Limits for zooming (0.5x to 10x)
        .translateExtent([[0, 0], [width, height]]) // Limits for panning
        .on('zoom', (event) => {
          zoomTransform = event.transform; // Update zoomTransform for lasso

          const newX = event.transform.rescaleX(x);
          const newY = event.transform.rescaleY(y);

          // Update axes with new zoomed scales
          xAxis.call(d3.axisBottom(newX));
          yAxis.call(d3.axisLeft(newY));

          // Update points' positions with new scales
          points.attr('cx', d => newX(d[0]))
            .attr('cy', d => newY(d[1]));
        });

      svg.call(zoom); // Apply the zoom behavior to the SVG
    }
  }, [embeddings, labels]);

  return (
    <div className="App">
      <h1>D3.js MNIST t-SNE Visualization with Freeform Lasso Selection</h1>
      <div>
        <svg ref={svgRef} width="800" height="600"></svg>
        <h2>Projection of Selected Points</h2>
        <svg ref={projectionSvgRef} width="400" height="400"></svg>
      </div>
    </div>
  );
}

export default App;
